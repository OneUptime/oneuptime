import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * SUBSCRIBERS HEAR ABOUT A POSTMORTEM ONCE, WHEN IT IS PUBLISHED.
 *
 * Found in #4422: any incident update that carried postmortemNote - changed
 * or not - put the postmortem's subscriber notification back to Pending and
 * added a "Postmortem Note updated" feed item (posted to Slack and Microsoft
 * Teams too). The Edit Postmortem form sends the note with every save, so
 * every save of a published postmortem emailed, texted and messaged every
 * subscriber of its status pages again; an API client or a workflow writing
 * the whole incident back did the same.
 *
 * What holds now: subscribers are told when the postmortem is published -
 * the first time it is on the status page, meaning Publish on Status Page is
 * on and the note says something (the status page shows nothing else). A
 * save that leaves the postmortem as it was does nothing. Editing a
 * published postmortem changes what the status page shows and is recorded
 * in the feed, once, but tells nobody. Taking it off the status page and
 * publishing it again tells them again: they saw it go.
 *
 * These run the real onBeforeUpdate and hand what it carries forward to the
 * real onUpdateSuccess; only the database and the side effects' own
 * services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-9057-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-9057-4aaa-8bbb-000000000002");
const RECORD_ID: string = "0193c0de-9057-4aaa-8bbb-0000000000a1";
const SECOND_RECORD_ID: string = "0193c0de-9057-4aaa-8bbb-0000000000a2";

const NOTE: string =
  "## What happened\n\nCheckout returned errors for 12 minutes after a bad deploy.";
const EDITED_NOTE: string = `${NOTE}\n\n## Follow-ups\n\n- Add a canary stage to the checkout deploy.`;
const PUBLISHED_AT: Date = new Date("2026-10-05T09:30:00.000Z");

type OnBeforeUpdate = (updateBy: UpdateBy<never>) => Promise<OnUpdate<never>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

interface Hooks {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
}

// The incident's postmortem as stored.
interface StoredPostmortem {
  showPostmortemOnStatusPage: boolean;
  postmortemNote: string | null;
  status: StatusPageSubscriberNotificationStatus;
  notifySubscribersOnPostmortemPublished?: boolean;
}

// Someone who may edit incidents, as the API sees them.
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

/*
 * What the Edit Postmortem form sends on Save Changes: every field it has,
 * whatever changed (ModelForm submits each of its fields, hidden ones too).
 */
function editPostmortemFormSave(values: {
  note: string | null;
  publish: boolean;
  notify?: boolean;
}): Record<string, unknown> {
  return {
    postmortemNote: values.note,
    postmortemAttachments: [],
    showPostmortemOnStatusPage: values.publish,
    notifySubscribersOnPostmortemPublished: values.notify ?? true,
    postmortemPostedAt: values.publish ? PUBLISHED_AT : null,
  };
}

let stored: Record<string, StoredPostmortem> = {};

let incidentReads: MockFunction;
let updateOneById: MockFunction;
let compareAndSet: MockFunction;
let feed: MockFunction;

function storedIncident(id: string): Incident {
  const row: StoredPostmortem = stored[id]!;
  const incident: Incident = new Incident();
  incident._id = id;
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";
  incident.showPostmortemOnStatusPage = row.showPostmortemOnStatusPage;
  incident.postmortemNote = row.postmortemNote as string;
  incident.notifySubscribersOnPostmortemPublished =
    row.notifySubscribersOnPostmortemPublished ?? true;
  incident.subscriberNotificationStatusOnPostmortemPublished = row.status;
  return incident;
}

beforeEach(() => {
  stored = {
    [RECORD_ID]: {
      showPostmortemOnStatusPage: false,
      postmortemNote: NOTE,
      // Settled when the incident was declared: nothing was on the page.
      status: StatusPageSubscriberNotificationStatus.Skipped,
    },
  };

  // Every record named here is the project's own.
  stubProjectDirectory({});

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  incidentReads = getJestMockFunction();
  incidentReads.mockImplementation(async (): Promise<Array<Incident>> => {
    return Object.keys(stored).map(storedIncident);
  });
  jest
    .spyOn(IncidentService, "findBy")
    .mockImplementation(incidentReads as never);

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

  updateOneById = getJestMockFunction();
  updateOneById.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "updateOneById")
    .mockImplementation(updateOneById as never);

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

  // Published At moves the incident's metrics; none of that is looked at here.
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
  } = {},
): Promise<OnUpdate<never>> {
  const hooks: Hooks = IncidentService as unknown as Hooks;

  const onUpdate: OnUpdate<never> = await hooks.onBeforeUpdate({
    query: (options.query || { _id: RECORD_ID }) as never,
    data: data as never,
    props: options.props || editor(),
    limit: 1,
    skip: 0,
  });

  return await hooks.onUpdateSuccess(
    onUpdate,
    (options.updatedIds || [RECORD_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

interface QueueWrite {
  id: string;
  data: Record<string, unknown>;
  expectedData?: Record<string, unknown> | undefined;
}

/*
 * Every write that puts the postmortem notification back to Pending - what
 * the send job picks up - however it is made.
 */
function postmortemNotificationsQueued(): Array<QueueWrite> {
  const writes: Array<QueueWrite> = [];

  for (const call of [
    ...updateOneById.mock.calls,
    ...compareAndSet.mock.calls,
  ]) {
    const input: {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData?: Record<string, unknown>;
    } = call[0] as {
      id: ObjectID;
      data: Record<string, unknown>;
      expectedData?: Record<string, unknown>;
    };

    if (
      input.data["subscriberNotificationStatusOnPostmortemPublished"] ===
      StatusPageSubscriberNotificationStatus.Pending
    ) {
      writes.push({
        id: input.id.toString(),
        data: input.data,
        expectedData: input.expectedData,
      });
    }
  }

  return writes;
}

function postmortemFeedItems(): Array<string> {
  return feed.mock.calls
    .filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { incidentFeedEventType: IncidentFeedEventType })
          .incidentFeedEventType === IncidentFeedEventType.PostmortemNote
      );
    })
    .map((call: Array<unknown>): string => {
      return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    });
}

describe("the Edit Postmortem form, saved again and again, tells subscribers once", () => {
  test("publishing the postmortem queues its notification once", async () => {
    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    expect(postmortemNotificationsQueued()[0]!.id).toBe(RECORD_ID);
  });

  test("saving the published postmortem again, unchanged, queues nothing and records nothing", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("editing the published postmortem records the new note once and tells nobody", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(
      editPostmortemFormSave({ note: EDITED_NOTE, publish: true }),
    );

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
    expect(postmortemFeedItems()[0]).toContain("Postmortem Note updated");
    expect(postmortemFeedItems()[0]).toContain("Add a canary stage");
  });

  test("taking the postmortem off the status page tells nobody", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: false }));

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("publishing it again after it was taken off tells subscribers again: they saw it go", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: NOTE,
      // Told when it was first published.
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toHaveLength(1);
  });

  test("a day of saves - write, publish, save, fix a typo, save - queues it once", async () => {
    // What the database and the send job do between the saves.
    const save: (values: {
      note: string | null;
      publish: boolean;
    }) => Promise<void> = async (values: {
      note: string | null;
      publish: boolean;
    }): Promise<void> => {
      const queuedBefore: number = postmortemNotificationsQueued().length;

      await runUpdate(editPostmortemFormSave(values));

      stored[RECORD_ID] = {
        ...stored[RECORD_ID]!,
        showPostmortemOnStatusPage: values.publish,
        postmortemNote: values.note,
      };

      if (postmortemNotificationsQueued().length > queuedBefore) {
        // The job ran and told everyone.
        stored[RECORD_ID]!.status =
          StatusPageSubscriberNotificationStatus.Success;
      }
    };

    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await save({ note: NOTE, publish: false });
    await save({ note: NOTE, publish: true });
    await save({ note: NOTE, publish: true });
    await save({ note: EDITED_NOTE, publish: true });
    await save({ note: EDITED_NOTE, publish: true });

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    // The note written, then the typo fix: each change once, nothing else.
    expect(postmortemFeedItems()).toHaveLength(2);
  });
});
