import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentPostmortemStatus from "../../../Models/DatabaseModels/IncidentPostmortemStatus";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentPostmortemStatusService from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWriteLikeFindBy } from "../TestingUtils/RowsCallerMayWrite";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT WRITING AND PUBLISHING A POSTMORTEM DOES TO ITS STATUS.
 *
 * Once an update that writes the postmortem's note or its Publish on Status
 * Page switch is written, OneUptime moves the postmortem
 * (Common/Utils/Incident/PostmortemStatus): its first note moves it from
 * not started to draft, publishing it moves it to completed unless it is
 * done already. The move is a hook-free compare-and-set from the status it
 * was in before the update, so a status someone picked meanwhile is never
 * written over, and an update that picks a status itself is never moved.
 * A status someone picks is recorded in the incident's feed when it really
 * changed.
 *
 * These run the real onBeforeUpdate and hand what it carries forward to the
 * real onUpdateSuccess; only the database and the side effects' own
 * services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-9057-4aaa-8ccc-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-9057-4aaa-8ccc-000000000002");
const RECORD_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000a1";
const SECOND_RECORD_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000a2";

const NOT_STARTED_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000b1";
const DRAFT_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000b2";
const IN_REVIEW_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000b3";
const COMPLETED_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000b4";
const NOT_NEEDED_ID: string = "0193c0de-9057-4aaa-8ccc-0000000000b5";

const NOTE: string = "## What happened\n\nCheckout failed for 12 minutes.";

type OnBeforeUpdate = (updateBy: UpdateBy<never>) => Promise<OnUpdate<never>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

interface Hooks {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
}

interface StoredIncident {
  postmortemNote: string | null;
  showPostmortemOnStatusPage: boolean;
  postmortemStatusId: string | null;
}

function status(
  id: string,
  name: string,
  order: number,
  flags: Record<string, boolean> = {},
): IncidentPostmortemStatus {
  const row: IncidentPostmortemStatus = new IncidentPostmortemStatus();
  row._id = id;
  row.name = name;
  row.order = order;
  row.isNotStartedStatus = Boolean(flags["isNotStartedStatus"]);
  row.isDraftStatus = Boolean(flags["isDraftStatus"]);
  row.isCompletedStatus = Boolean(flags["isCompletedStatus"]);
  return row;
}

// The four a project starts with, and In Review it added.
const STATUSES: Array<IncidentPostmortemStatus> = [
  status(NOT_STARTED_ID, "Not Started", 1, { isNotStartedStatus: true }),
  status(DRAFT_ID, "Draft", 2, { isDraftStatus: true }),
  status(IN_REVIEW_ID, "In Review", 3),
  status(COMPLETED_ID, "Completed", 4, { isCompletedStatus: true }),
  status(NOT_NEEDED_ID, "Not Needed", 5),
];

function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectAdmin].map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

let stored: Record<string, StoredIncident> = {};

let compareAndSet: MockFunction;
let feed: MockFunction;
let statusReads: MockFunction;
let statusLookups: MockFunction;

function storedIncident(id: string): Incident {
  const incident: Incident = new Incident();
  incident._id = id;
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";

  const row: StoredIncident | undefined = stored[id];

  if (row) {
    incident.postmortemNote = row.postmortemNote as string;
    incident.showPostmortemOnStatusPage = row.showPostmortemOnStatusPage;
    incident.subscriberNotificationStatusOnPostmortemPublished =
      StatusPageSubscriberNotificationStatus.Skipped;

    if (row.postmortemStatusId) {
      incident.postmortemStatusId = new ObjectID(row.postmortemStatusId);
    }
  }

  return incident;
}

beforeEach(() => {
  stored = {
    [RECORD_ID]: {
      postmortemNote: null,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: NOT_STARTED_ID,
    },
  };

  stubProjectDirectory({});

  stubRowsCallerMayWriteLikeFindBy(
    IncidentService,
    jest.spyOn(IncidentService, "findBy"),
  );

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  jest.spyOn(IncidentService, "findBy").mockImplementation((async (): Promise<
    Array<Incident>
  > => {
    return Object.keys(stored).map(storedIncident);
  }) as never);

  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (findOneById: {
      id: ObjectID;
    }): Promise<Incident> => {
      return storedIncident(findOneById.id.toString());
    }) as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);

  jest
    .spyOn(IncidentService, "updateOneById")
    .mockResolvedValue(undefined as never);

  compareAndSet = getJestMockFunction();
  compareAndSet.mockResolvedValue(true as never);
  jest
    .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation(compareAndSet as never);

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(feed as never);

  statusReads = getJestMockFunction();
  statusReads.mockResolvedValue(STATUSES as never);
  jest
    .spyOn(IncidentPostmortemStatusService, "getProjectStatuses")
    .mockImplementation(statusReads as never);

  statusLookups = getJestMockFunction();
  statusLookups.mockImplementation((async (findOneBy: {
    query: { _id: ObjectID };
  }): Promise<IncidentPostmortemStatus | null> => {
    return (
      STATUSES.find((candidate: IncidentPostmortemStatus): boolean => {
        return candidate._id === findOneBy.query._id.toString();
      }) || null
    );
  }) as never);
  jest
    .spyOn(IncidentPostmortemStatusService, "findOneBy")
    .mockImplementation(statusLookups as never);

  jest
    .spyOn(IncidentService, "refreshIncidentMetrics")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentMeasurementValueService, "recomputeForIncident")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
    .mockResolvedValue(ObjectID.generate() as never);
  jest
    .spyOn(IncidentStateTimelineService, "findOneBy")
    .mockResolvedValue(null as never);
  jest.spyOn(logger, "error").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runUpdate(
  data: Record<string, unknown>,
  options: {
    query?: Record<string, unknown>;
    updatedIds?: Array<string>;
    props?: DatabaseCommonInteractionProps;
    // What happens to the carried values between the hooks: a row unseen.
    meanwhile?: (onUpdate: OnUpdate<never>) => void;
  } = {},
): Promise<void> {
  const hooks: Hooks = IncidentService as unknown as Hooks;

  const onUpdate: OnUpdate<never> = await hooks.onBeforeUpdate({
    query: (options.query || { _id: RECORD_ID }) as never,
    data: data as never,
    props: options.props || editor(),
    limit: 1,
    skip: 0,
  });

  options.meanwhile?.(onUpdate);

  await hooks.onUpdateSuccess(
    onUpdate,
    (options.updatedIds || [RECORD_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

interface StatusMove {
  id: string;
  to: string;
  from: string | null;
}

// Every compare-and-set that moves a postmortem's status.
function statusMoves(): Array<StatusMove> {
  return compareAndSet.mock.calls
    .map((call: Array<unknown>): StatusMove | null => {
      const input: {
        id: ObjectID;
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      } = call[0] as {
        id: ObjectID;
        data: Record<string, unknown>;
        expectedData: Record<string, unknown>;
      };

      if (input.data["postmortemStatusId"] === undefined) {
        return null;
      }

      const from: unknown = input.expectedData["postmortemStatusId"];

      return {
        id: input.id.toString(),
        to: String(input.data["postmortemStatusId"]),
        from: from === null || from === undefined ? null : String(from),
      };
    })
    .filter((move: StatusMove | null): move is StatusMove => {
      return move !== null;
    });
}

// The incident's "updated" feed items.
function updatedFeedItems(): Array<string> {
  return feed.mock.calls
    .map((call: Array<unknown>): {
      incidentFeedEventType: IncidentFeedEventType;
      feedInfoInMarkdown: string;
    } => {
      return call[0] as {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      };
    })
    .filter(
      (item: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): boolean => {
        return (
          item.incidentFeedEventType === IncidentFeedEventType.IncidentUpdated
        );
      },
    )
    .map(
      (item: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): string => {
        return item.feedInfoInMarkdown;
      },
    );
}

describe("writing the postmortem's first note", () => {
  test("moves it from not started to draft, only while it is still not started", async () => {
    await runUpdate({ postmortemNote: NOTE });

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: DRAFT_ID, from: NOT_STARTED_ID },
    ]);
  });

  test("an incident with no status yet moves to draft, while it still has none", async () => {
    stored[RECORD_ID]!.postmortemStatusId = null;

    await runUpdate({ postmortemNote: NOTE });

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: DRAFT_ID, from: null },
    ]);
  });

  test("the Edit Postmortem form's whole save moves it too", async () => {
    await runUpdate({
      postmortemNote: NOTE,
      postmortemAttachments: [],
      showPostmortemOnStatusPage: false,
      notifySubscribersOnPostmortemPublished: true,
      postmortemPostedAt: null,
    });

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: DRAFT_ID, from: NOT_STARTED_ID },
    ]);
  });

  test("editing a note already written moves nothing", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: IN_REVIEW_ID,
    };

    await runUpdate({ postmortemNote: `${NOTE}\n\nMore.` });

    expect(statusMoves()).toEqual([]);
  });

  test("a first note on a postmortem moved on already leaves it where it is", async () => {
    stored[RECORD_ID]!.postmortemStatusId = NOT_NEEDED_ID;

    await runUpdate({ postmortemNote: NOTE });

    expect(statusMoves()).toEqual([]);
  });

  test("clearing the note moves nothing back", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: DRAFT_ID,
    };

    await runUpdate({ postmortemNote: "" });

    expect(statusMoves()).toEqual([]);
  });
});

describe("publishing the postmortem on a status page", () => {
  test("moves a postmortem under way to completed", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: IN_REVIEW_ID,
    };

    await runUpdate({ showPostmortemOnStatusPage: true });

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: COMPLETED_ID, from: IN_REVIEW_ID },
    ]);
  });

  test("written and published in one save, it goes straight to completed", async () => {
    await runUpdate({
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
    });

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: COMPLETED_ID, from: NOT_STARTED_ID },
    ]);
  });

  test("a postmortem the team called not needed stays not needed", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: NOT_NEEDED_ID,
    };

    await runUpdate({ showPostmortemOnStatusPage: true });

    expect(statusMoves()).toEqual([]);
  });

  test("saving a published postmortem again moves nothing", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
      postmortemStatusId: DRAFT_ID,
    };

    await runUpdate({
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
    });

    expect(statusMoves()).toEqual([]);
  });

  test("taking it off the status page moves nothing back", async () => {
    stored[RECORD_ID] = {
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
      postmortemStatusId: COMPLETED_ID,
    };

    await runUpdate({ showPostmortemOnStatusPage: false });

    expect(statusMoves()).toEqual([]);
  });
});

describe("a status the update picks", () => {
  test("stands: the same save's note or publish never moves it", async () => {
    await runUpdate({
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
      postmortemStatusId: new ObjectID(IN_REVIEW_ID),
    });

    expect(statusMoves()).toEqual([]);
    expect(statusReads).not.toHaveBeenCalled();
  });

  test("is recorded in the incident's feed when it really changed", async () => {
    stored[RECORD_ID]!.postmortemStatusId = DRAFT_ID;

    await runUpdate({ postmortemStatusId: new ObjectID(IN_REVIEW_ID) });

    expect(updatedFeedItems()).toHaveLength(1);
    expect(updatedFeedItems()[0]).toContain("**📘 Postmortem Status**:");
    expect(updatedFeedItems()[0]).toContain("In Review");

    // Looked up in the incident's project.
    expect(
      (
        statusLookups.mock.calls[0]![0] as {
          query: Record<string, unknown>;
        }
      ).query["projectId"],
    ).toEqual(PROJECT_ID);
  });

  test("named by the relation, as a dashboard form sends it, is recorded too", async () => {
    stored[RECORD_ID]!.postmortemStatusId = DRAFT_ID;

    await runUpdate({ postmortemStatus: { _id: COMPLETED_ID } });

    expect(updatedFeedItems()).toHaveLength(1);
    expect(updatedFeedItems()[0]).toContain("Completed");
  });

  test("written back unchanged records nothing", async () => {
    stored[RECORD_ID]!.postmortemStatusId = DRAFT_ID;

    await runUpdate({ postmortemStatusId: new ObjectID(DRAFT_ID) });

    expect(updatedFeedItems()).toEqual([]);
  });

  test("a move OneUptime makes by itself adds no line of its own", async () => {
    await runUpdate({ postmortemNote: NOTE });

    expect(statusMoves()).toHaveLength(1);
    expect(updatedFeedItems()).toEqual([]);
  });
});

describe("the move is made only while the postmortem is where it was", () => {
  test("an incident the read before the write did not see is read again, and moved from where it is now", async () => {
    stored[RECORD_ID]!.postmortemStatusId = NOT_STARTED_ID;

    await runUpdate(
      { postmortemNote: NOTE },
      {
        meanwhile: (onUpdate: OnUpdate<never>) => {
          // The row the update matched only when it was written.
          (onUpdate as unknown as { carryForward: unknown }).carryForward = {};
        },
      },
    );

    expect(statusMoves()).toEqual([
      { id: RECORD_ID, to: DRAFT_ID, from: NOT_STARTED_ID },
    ]);
  });

  test("the project's statuses are read once for an update of many incidents", async () => {
    stored[SECOND_RECORD_ID] = {
      postmortemNote: null,
      showPostmortemOnStatusPage: false,
      postmortemStatusId: NOT_STARTED_ID,
    };

    await runUpdate(
      { postmortemNote: NOTE },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [RECORD_ID, SECOND_RECORD_ID],
      },
    );

    expect(statusMoves()).toHaveLength(2);
    expect(statusReads).toHaveBeenCalledTimes(1);
  });

  test("statuses that cannot be read move nothing and fail nothing: the save stands", async () => {
    statusReads.mockRejectedValue(new Error("Database not connected") as never);

    await expect(runUpdate({ postmortemNote: NOTE })).resolves.toBeUndefined();

    expect(statusMoves()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "Moving the postmortem's status failed in IncidentService.onUpdateSuccess",
      ),
      expect.anything(),
    );
  });

  test("an update that writes neither the note nor the switch reads no statuses", async () => {
    await runUpdate({ title: "Checkout is slow" });

    expect(statusReads).not.toHaveBeenCalled();
    expect(statusMoves()).toEqual([]);
  });
});
