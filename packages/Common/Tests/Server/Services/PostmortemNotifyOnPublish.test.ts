import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "../../../Server/Services/IncidentMeasurementValueService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import IncidentPostmortemPublication from "../../../Types/StatusPage/IncidentPostmortemPublication";
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
  const incident: Incident = new Incident();
  incident._id = id;
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 42;
  incident.incidentNumberWithPrefix = "INC-42";

  const row: StoredPostmortem | undefined = stored[id];

  if (row) {
    incident.showPostmortemOnStatusPage = row.showPostmortemOnStatusPage;
    incident.postmortemNote = row.postmortemNote as string;
    incident.notifySubscribersOnPostmortemPublished =
      row.notifySubscribersOnPostmortemPublished ?? true;
    incident.subscriberNotificationStatusOnPostmortemPublished = row.status;
  }

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

  test("the queued notification says why it is waiting, and is written only while it stands where it was read", async () => {
    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toEqual([
      {
        id: RECORD_ID,
        data: {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Pending,
          subscriberNotificationStatusMessageOnPostmortemPublished:
            IncidentPostmortemPublication.queuedMessage,
        },
        expectedData: {
          subscriberNotificationStatusOnPostmortemPublished:
            StatusPageSubscriberNotificationStatus.Skipped,
        },
      },
    ]);

    /*
     * A hook-free write of those two columns, like the job's own claim: no
     * second update of the incident, no workflow run, no audit entry.
     */
    expect(updateOneById).not.toHaveBeenCalled();
  });

  test("a notification someone else queued, or a job claimed, since the read is left to them", async () => {
    // The compare-and-set finds the status moved on.
    compareAndSet.mockResolvedValue(false as never);

    await expect(
      runUpdate(editPostmortemFormSave({ note: NOTE, publish: true })),
    ).resolves.toBeDefined();

    expect(compareAndSet).toHaveBeenCalledTimes(1);
    // Nothing writes it a second way.
    expect(updateOneById).not.toHaveBeenCalled();
  });
});

describe("what counts as published: the status page shows the postmortem", () => {
  test("switching publishing on with no note tells nobody, and writing the note then tells them once", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate(editPostmortemFormSave({ note: null, publish: true }));

    expect(postmortemNotificationsQueued()).toEqual([]);

    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    expect(postmortemFeedItems()).toHaveLength(1);
  });

  test("writing the note and publishing it in one save records the note and tells subscribers, once each", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    expect(postmortemFeedItems()).toHaveLength(1);
    expect(postmortemFeedItems()[0]).toContain("Postmortem Note updated");
  });

  test("emptying a published postmortem's note records it as cleared and tells nobody; writing one again tells them again", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(editPostmortemFormSave({ note: "", publish: true }));

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
    expect(postmortemFeedItems()[0]).toContain("Postmortem Note cleared");

    // The status page stopped showing it; the note coming back is news.
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: "",
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemNotificationsQueued()).toHaveLength(1);
  });

  test.each([
    ["whitespace around it", `\n\n${NOTE}   \n`],
    ["Windows line endings", NOTE.replace(/\n/g, "\r\n")],
  ])(
    "the published note saved again with %s is the same note: nothing is recorded or sent",
    async (_label: string, note: string) => {
      stored[RECORD_ID] = {
        showPostmortemOnStatusPage: true,
        postmortemNote: NOTE,
        status: StatusPageSubscriberNotificationStatus.Success,
      };

      await runUpdate(editPostmortemFormSave({ note: note, publish: true }));

      expect(postmortemNotificationsQueued()).toEqual([]);
      expect(postmortemFeedItems()).toEqual([]);
    },
  );

  test("no note saved as an empty one is no change", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate(editPostmortemFormSave({ note: "", publish: false }));

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("a note written while publishing is off is recorded, and tells nobody until it is published", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: false }));

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
  });
});

describe("updates that are not the Edit Postmortem form", () => {
  test("an API client writing the whole incident back, postmortem unchanged, sets off nothing", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate({
      title: "Checkout errors",
      postmortemNote: NOTE,
      showPostmortemOnStatusPage: true,
      notifySubscribersOnPostmortemPublished: true,
      postmortemPostedAt: PUBLISHED_AT,
    });

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("the API or Terraform switching publishing on over a written note tells subscribers once", async () => {
    await runUpdate({ showPostmortemOnStatusPage: true });

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    // The note did not change, so the feed has nothing to record.
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("the API or Terraform changing the note of a published postmortem records it and tells nobody", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate({ postmortemNote: EDITED_NOTE });

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
  });

  test("an AI draft written into a postmortem switched on with no note is the moment it is published", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    // As IncidentPostmortemRunner writes it, as root.
    await runUpdate({ postmortemNote: NOTE }, { props: { isRoot: true } });

    expect(postmortemNotificationsQueued()).toHaveLength(1);
    expect(postmortemFeedItems()).toHaveLength(1);
  });

  test("an AI draft written into an unpublished postmortem is recorded and tells nobody", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: null,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate({ postmortemNote: NOTE }, { props: { isRoot: true } });

    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toHaveLength(1);
  });

  test.each([true, false])(
    "writing Notify Subscribers (%s) on its own reads nothing and sends nothing",
    async (notify: boolean) => {
      stored[RECORD_ID] = {
        showPostmortemOnStatusPage: true,
        postmortemNote: NOTE,
        status: StatusPageSubscriberNotificationStatus.Skipped,
        notifySubscribersOnPostmortemPublished: !notify,
      };

      await runUpdate({ notifySubscribersOnPostmortemPublished: notify });

      expect(postmortemNotificationsQueued()).toEqual([]);
      expect(postmortemFeedItems()).toEqual([]);
      expect(incidentReads).not.toHaveBeenCalled();
    },
  );

  test("publishing with Notify Subscribers off still queues it: the job reads the switch and skips it with its reason", async () => {
    await runUpdate(
      editPostmortemFormSave({ note: NOTE, publish: true, notify: false }),
    );

    expect(postmortemNotificationsQueued()).toHaveLength(1);
  });

  test("Retry or the API's Pending sent with the publish is the one Pending written: the hook adds none of its own", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Failed,
    };

    const onUpdate: OnUpdate<never> = await runUpdate({
      showPostmortemOnStatusPage: true,
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    expect(compareAndSet).not.toHaveBeenCalled();
    expect(updateOneById).not.toHaveBeenCalled();
    // The caller's own Pending goes out with the update itself.
    expect(
      (onUpdate.updateBy.data as unknown as Record<string, unknown>)[
        "subscriberNotificationStatusOnPostmortemPublished"
      ],
    ).toBe(StatusPageSubscriberNotificationStatus.Pending);
  });

  test("a status the caller sets with the publish is theirs: nothing is queued over it", async () => {
    await runUpdate({
      showPostmortemOnStatusPage: true,
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Skipped,
    });

    expect(postmortemNotificationsQueued()).toEqual([]);
  });

  test.each([
    [
      "still waiting for the job - an incident declared moments ago",
      StatusPageSubscriberNotificationStatus.Pending,
    ],
    ["being sent", StatusPageSubscriberNotificationStatus.InProgress],
  ])(
    "publishing while the notification is %s queues nothing more: it is on its way",
    async (_label: string, status: StatusPageSubscriberNotificationStatus) => {
      stored[RECORD_ID] = {
        showPostmortemOnStatusPage: false,
        postmortemNote: NOTE,
        status: status,
      };

      await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

      expect(postmortemNotificationsQueued()).toEqual([]);
    },
  );
});

describe("the stored postmortem is read once, before the write", () => {
  function postmortemReads(): Array<{
    select: Record<string, unknown>;
    query: Record<string, unknown>;
  }> {
    return incidentReads.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          select: Record<string, unknown>;
          query: Record<string, unknown>;
        };
      })
      .filter(
        (read: {
          select: Record<string, unknown>;
          query: Record<string, unknown>;
        }): boolean => {
          return read.select?.["postmortemNote"] === true;
        },
      );
  }

  test("with only the columns compared, within the caller's project", async () => {
    await runUpdate(editPostmortemFormSave({ note: NOTE, publish: true }));

    expect(postmortemReads()).toHaveLength(1);
    expect(postmortemReads()[0]!.select).toEqual({
      _id: true,
      postmortemNote: true,
      showPostmortemOnStatusPage: true,
      subscriberNotificationStatusOnPostmortemPublished: true,
    });
    expect(postmortemReads()[0]!.query).toEqual(
      expect.objectContaining({ _id: RECORD_ID, projectId: PROJECT_ID }),
    );
  });

  test("an update that writes neither the note nor the switch reads none of it, and does nothing to the postmortem", async () => {
    await runUpdate({ title: "Renamed", postmortemPostedAt: PUBLISHED_AT });

    expect(postmortemReads()).toEqual([]);
    expect(postmortemNotificationsQueued()).toEqual([]);
    expect(postmortemFeedItems()).toEqual([]);
  });

  test("an update that writes a severity and the postmortem reads both in the one read", async () => {
    const MINOR: string = "0193c0de-9057-4aaa-8bbb-0000000000b1";
    const CRITICAL: string = "0193c0de-9057-4aaa-8bbb-0000000000b2";

    incidentReads.mockImplementation(async (): Promise<Array<Incident>> => {
      const incident: Incident = storedIncident(RECORD_ID);
      incident.incidentSeverityId = new ObjectID(MINOR);
      return [incident];
    });

    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation((async (): Promise<IncidentSeverity> => {
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = CRITICAL;
        severity.name = "Critical";
        return severity;
      }) as never);
    jest
      .spyOn(IncidentSlaService, "recalculateDeadlines")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "refreshReminderSchedule")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "getIncidentMetricContext")
      .mockResolvedValue({ baseMetricAttributes: {} } as never);
    jest
      .spyOn(
        IncidentService as unknown as {
          getMetricRetentionDays: () => Promise<number>;
        },
        "getMetricRetentionDays",
      )
      .mockResolvedValue(30 as never);
    jest
      .spyOn(MutableMetricService, "createMutableMetrics")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);

    await runUpdate({
      incidentSeverityId: new ObjectID(CRITICAL),
      ...editPostmortemFormSave({ note: NOTE, publish: true }),
    });

    expect(incidentReads).toHaveBeenCalledTimes(1);
    expect(
      (incidentReads.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toEqual({
      _id: true,
      incidentSeverityId: true,
      postmortemNote: true,
      showPostmortemOnStatusPage: true,
      subscriberNotificationStatusOnPostmortemPublished: true,
    });

    // Both comparisons ran on that one read.
    expect(postmortemNotificationsQueued()).toHaveLength(1);
    expect(IncidentSlaService.recalculateDeadlines).toHaveBeenCalledTimes(1);
  });

  test("one update over two incidents queues the notification only for the one it publishes", async () => {
    stored = {
      [RECORD_ID]: {
        showPostmortemOnStatusPage: false,
        postmortemNote: NOTE,
        status: StatusPageSubscriberNotificationStatus.Skipped,
      },
      [SECOND_RECORD_ID]: {
        showPostmortemOnStatusPage: true,
        postmortemNote: NOTE,
        status: StatusPageSubscriberNotificationStatus.Success,
      },
    };

    await runUpdate(
      { showPostmortemOnStatusPage: true },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [RECORD_ID, SECOND_RECORD_ID],
      },
    );

    expect(postmortemReads()).toHaveLength(1);
    expect(
      postmortemNotificationsQueued().map((write: QueueWrite): string => {
        return write.id;
      }),
    ).toEqual([RECORD_ID]);
  });

  test("an incident the read did not see counts as changed, so a real publish is never missed", async () => {
    // The write found a second incident the read before it did not.
    await runUpdate(
      { postmortemNote: NOTE, showPostmortemOnStatusPage: true },
      { updatedIds: [RECORD_ID, SECOND_RECORD_ID] },
    );

    const queued: Array<QueueWrite> = postmortemNotificationsQueued();

    // The stored incident had the note already: published by this update.
    expect(
      queued.map((write: QueueWrite): string => {
        return write.id;
      }),
    ).toEqual([RECORD_ID, SECOND_RECORD_ID]);
    // With no status read for it, the write is made on its id alone.
    expect(queued[1]!.expectedData).toEqual({});
    // Its note counts as written fresh; the stored one's did not change.
    expect(postmortemFeedItems()).toHaveLength(1);
  });
});

describe("the feed item for a changed note", () => {
  function postmortemFeedCalls(): Array<Record<string, unknown>> {
    return feed.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as Record<string, unknown>;
      })
      .filter((input: Record<string, unknown>): boolean => {
        return (
          input["incidentFeedEventType"] ===
          IncidentFeedEventType.PostmortemNote
        );
      });
  }

  test("names the incident, carries the new note, credits the editor and goes to the workspace channels", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: true,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Success,
    };

    await runUpdate(
      editPostmortemFormSave({ note: EDITED_NOTE, publish: true }),
    );

    expect(postmortemFeedCalls()).toHaveLength(1);

    const item: Record<string, unknown> = postmortemFeedCalls()[0]!;

    expect(item["feedInfoInMarkdown"]).toBe(
      `**📘 Postmortem Note updated for [Incident INC-42](https://oneuptime.test/i)**\n\n${EDITED_NOTE}`,
    );
    expect(String(item["incidentId"])).toBe(RECORD_ID);
    expect(String(item["userId"])).toBe(USER_ID.toString());
    expect(item["workspaceNotification"]).toEqual({
      sendWorkspaceNotification: true,
    });
  });

  test("an emptied note is recorded as cleared", async () => {
    stored[RECORD_ID] = {
      showPostmortemOnStatusPage: false,
      postmortemNote: NOTE,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    };

    await runUpdate({ postmortemNote: null });

    expect(postmortemFeedCalls()).toHaveLength(1);
    expect(postmortemFeedCalls()[0]!["feedInfoInMarkdown"]).toBe(
      "**📘 Postmortem Note cleared for [Incident INC-42](https://oneuptime.test/i)**\n\n_No postmortem note provided._",
    );
  });
});
