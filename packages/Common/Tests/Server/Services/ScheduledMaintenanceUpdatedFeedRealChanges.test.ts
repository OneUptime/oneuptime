import DatabaseConfig from "../../../Server/DatabaseConfig";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import LabelService from "../../../Server/Services/LabelService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceMeasurementValueService from "../../../Server/Services/ScheduledMaintenanceMeasurementValueService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "../../../Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import Host from "../../../Models/DatabaseModels/Host";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import { JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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
 * A SCHEDULED MAINTENANCE EVENT'S "UPDATED" FEED ITEM RECORDS WHAT AN EDIT
 * REALLY CHANGED.
 *
 * The event's Maintenance Details card sends the title, the window, the
 * labels, the status pages and the reminders before the event with every
 * save; the Description page sends the description; the Affected Resources
 * card sends the monitors and every other affected-resource list; an API
 * client, Terraform or a workflow may write the whole event back. The feed
 * lines used to follow whether an update carried a field, not whether it
 * changed it: every such save added an "updated" item repeating what it
 * carried - posted to the event's Slack and Microsoft Teams channels too -
 * and any write carrying the labels or the Send reminders switch matched
 * the reminder rule again, which starts the reminder interval over, so an
 * event edited often kept putting its owners' reminders off.
 *
 * Now ScheduledMaintenanceService reads what each event holds before the
 * write - one read of its own columns the update writes, and one per list
 * - and each line, and the reminder refresh, follows a real change. These
 * tests run the real onBeforeUpdate and hand what it carries forward to the
 * real onUpdateSuccess; only the database and the side effects' own
 * services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5eed-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5eed-4aaa-8bbb-000000000002");
const EVENT_ID: string = "0193c0de-5eed-4aaa-8bbb-0000000000e1";
const SECOND_EVENT_ID: string = "0193c0de-5eed-4aaa-8bbb-0000000000e2";

const CHECKOUT: string = "0193c0de-5eed-4aaa-8bbb-0000000000c1";
const PAYMENTS: string = "0193c0de-5eed-4aaa-8bbb-0000000000c2";
const EU_WEST: string = "0193c0de-5eed-4aaa-8bbb-0000000000c3";

const PUBLIC_PAGE: string = "0193c0de-5eed-4aaa-8bbb-0000000000b1";
const INTERNAL_PAGE: string = "0193c0de-5eed-4aaa-8bbb-0000000000b2";

const MONITOR_A: string = "0193c0de-5eed-4aaa-8bbb-0000000000a1";

const HOST_1: string = "0193c0de-5eed-4aaa-8bbb-0000000000d1";
const HOST_2: string = "0193c0de-5eed-4aaa-8bbb-0000000000d2";

const DEGRADED_STATUS: string = "0193c0de-5eed-4aaa-8bbb-0000000000f1";

const LABEL_NAMES: Record<string, string> = {
  [CHECKOUT]: "checkout",
  [PAYMENTS]: "payments",
  [EU_WEST]: "eu-west",
};

const STATUS_PAGE_NAMES: Record<string, string> = {
  [PUBLIC_PAGE]: "Public status page",
  [INTERNAL_PAGE]: "Internal status page",
};

const HOST_NAMES: Record<string, string> = {
  [HOST_1]: "web-01",
  [HOST_2]: "web-02",
};

const STORED_TITLE: string = "Database upgrade";
const STORED_DESCRIPTION: string =
  "We are upgrading the primary database.\n\nExpect a short read-only window.";
const STORED_STARTS_AT: string = "2026-11-02T09:00:00.000Z";
const STORED_ENDS_AT: string = "2026-11-02T11:00:00.000Z";

const DASHBOARD: string = "https://oneuptime.example/dashboard";

function reminder(count: number, interval: EventInterval): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalType = interval;
  recurring.intervalCount = new PositiveNumber(count);
  return recurring;
}

/*
 * A reminder as an API client sends it: its JSON, which the API reads back
 * into a Recurring of its own (JSONFunctions.deserialize) before the hooks.
 */
function reminderFromApi(count: number, interval: EventInterval): Recurring {
  return JSONFunctions.deserializeValue(
    reminder(count, interval).toJSON(),
  ) as unknown as Recurring;
}

// An event as the database holds it.
interface StoredEvent {
  id: string;
  title: string | null;
  description: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  reminders: Array<Recurring> | null;
  enableReminders: boolean | null;
  labelIds: Array<string>;
  statusPageIds: Array<string>;
  monitorIds: Array<string>;
  hostIds: Array<string>;
  changeMonitorStatusToId: string | null;
}

function storedEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: EVENT_ID,
    title: STORED_TITLE,
    description: STORED_DESCRIPTION,
    startsAt: new Date(STORED_STARTS_AT),
    endsAt: new Date(STORED_ENDS_AT),
    reminders: [reminder(1, EventInterval.Day), reminder(2, EventInterval.Hour)],
    enableReminders: true,
    labelIds: [CHECKOUT, PAYMENTS],
    statusPageIds: [PUBLIC_PAGE],
    monitorIds: [MONITOR_A],
    hostIds: [HOST_1],
    changeMonitorStatusToId: DEGRADED_STATUS,
    ...overrides,
  };
}

// The lists each column of an event holds, by the column's name.
const LIST_COLUMNS: Record<string, keyof StoredEvent> = {
  labels: "labelIds",
  statusPages: "statusPageIds",
  monitors: "monitorIds",
  hosts: "hostIds",
};

function scheduledState(): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state._id = "0193c0de-5eed-4aaa-8bbb-000000000071";
  state.order = 1;
  state.isScheduledState = true;
  state.isOngoingState = false;
  state.isEndedState = false;
  state.isResolvedState = false;
  return state;
}

function listOf(
  column: string,
  ids: Array<string>,
): Array<Label | StatusPage | Monitor | Host> {
  return ids.map((id: string): Label | StatusPage | Monitor | Host => {
    const row: Label | StatusPage | Monitor | Host =
      column === "labels"
        ? new Label()
        : column === "statusPages"
          ? new StatusPage()
          : column === "monitors"
            ? new Monitor()
            : new Host();
    row._id = id;
    return row;
  });
}

/*
 * A stored event as findBy and findOneById answer it: the columns the read
 * asks for, and no others. A NULL column comes back as null, an empty list
 * as [].
 */
function rowOf(record: StoredEvent, select: Dictionary<unknown>): JSONObject {
  const row: ScheduledMaintenance = new ScheduledMaintenance();
  const columns: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  row._id = record.id;
  row.projectId = PROJECT_ID;

  for (const column of Object.keys(select)) {
    if (LIST_COLUMNS[column]) {
      columns[column] = listOf(
        column,
        record[LIST_COLUMNS[column]!] as Array<string>,
      );
      continue;
    }

    switch (column) {
      case "title":
      case "description":
      case "startsAt":
      case "endsAt":
      case "enableReminders":
        columns[column] = record[column];
        break;
      case "sendSubscriberNotificationsOnBeforeTheEvent":
        columns[column] = record.reminders;
        break;
      case "changeMonitorStatusToId":
        columns[column] = record.changeMonitorStatusToId
          ? new ObjectID(record.changeMonitorStatusToId)
          : null;
        break;
      case "currentScheduledMaintenanceState":
        row.currentScheduledMaintenanceState = scheduledState();
        break;
      default:
        // Every other list the event can hold is empty here.
        if (select[column] && typeof select[column] === "object") {
          columns[column] = [];
        }
    }
  }

  return row as unknown as JSONObject;
}

// The stored events a read matches: by its _id, or every one.
function matching(
  records: Array<StoredEvent>,
  query: Dictionary<unknown>,
): Array<StoredEvent> {
  const id: unknown = query["_id"];

  if (typeof id !== "string" && !(id instanceof ObjectID)) {
    return records;
  }

  return records.filter((record: StoredEvent): boolean => {
    return record.id === id.toString().toLowerCase();
  });
}

// The ids a QueryHelper.any() asks for: an IN over its Raw's parameters.
function idsAskedFor(value: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Dictionary<unknown> } = (value ||
    {}) as { objectLiteralParameters?: Dictionary<unknown> };

  return (
    Object.values(operator.objectLiteralParameters || {}) as Array<
      Array<unknown>
    >
  )
    .flat()
    .map((id: unknown): string => {
      return String(id).toLowerCase();
    });
}

// The ids a written list names, however each was spelled.
function idsWritten(list: unknown): Array<string> {
  return (Array.isArray(list) ? list : [])
    .map((entry: unknown): string => {
      if (entry && typeof entry === "object" && "_id" in entry) {
        return String((entry as { _id: unknown })._id).toLowerCase();
      }

      return String(entry).toLowerCase();
    })
    .filter((id: string): boolean => {
      return id.length > 0;
    });
}

// Someone who may edit scheduled maintenance events, as the API sees them.
function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

type OnBeforeUpdate = (
  updateBy: UpdateBy<ScheduledMaintenance>,
) => Promise<OnUpdate<ScheduledMaintenance>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<ScheduledMaintenance>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<ScheduledMaintenance>>;

const hooks: { onBeforeUpdate: OnBeforeUpdate; onUpdateSuccess: OnUpdateSuccess } =
  ScheduledMaintenanceService as unknown as {
    onBeforeUpdate: OnBeforeUpdate;
    onUpdateSuccess: OnUpdateSuccess;
  };

const TITLE_HEADING: string = "**Title**";
const DESCRIPTION_HEADING: string = "**Scheduled Maintenance Description**";
const STARTS_AT_HEADING: string = "**Starts At**";
const ENDS_AT_HEADING: string = "**Ends At**";
const REMINDERS_HEADING: string = "**Notify Subscribers Before Event Starts**";
const RESOURCES_HEADING: string = "**Resources Affected**";
const STATUS_PAGES_HEADING: string = "**Shown on Status Pages**";
const LABELS_HEADING: string = "**🏷️ Labels**";
const MONITOR_STATUS_HEADING: string = "**Change Monitor Status to**";

// Every heading an updated feed item can carry, apart from the monitors'.
const ALL_HEADINGS: Array<string> = [
  TITLE_HEADING,
  DESCRIPTION_HEADING,
  STARTS_AT_HEADING,
  ENDS_AT_HEADING,
  REMINDERS_HEADING,
  RESOURCES_HEADING,
  STATUS_PAGES_HEADING,
  LABELS_HEADING,
  MONITOR_STATUS_HEADING,
  "Show on these status pages",
  "**Labels**",
];

// What the database holds before the write, and after it.
let storedEvents: Array<StoredEvent> = [];
let eventsAfterWrite: Array<StoredEvent> = [];

let reads: MockFunction;
let feed: MockFunction;
let refreshReminders: MockFunction;
let labelReads: MockFunction;
let statusPageReads: MockFunction;
let resourceReads: MockFunction;

beforeEach(() => {
  storedEvents = [storedEvent()];
  eventsAfterWrite = [];

  // Every label, page and resource named here is the project's own.
  stubProjectDirectory({});

  reads = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<JSONObject>> => {
      return matching(storedEvents, findBy.query).map(
        (record: StoredEvent): JSONObject => {
          return rowOf(record, findBy.select);
        },
      );
    },
  );
  jest.spyOn(ScheduledMaintenanceService, "findBy").mockImplementation(
    reads as never,
  );

  // The event as it reads after the write.
  jest.spyOn(ScheduledMaintenanceService, "findOneById").mockImplementation(
    (async (findOneById: {
      id: ObjectID;
      select: Dictionary<unknown>;
    }): Promise<JSONObject | null> => {
      const record: StoredEvent | undefined = (
        eventsAfterWrite.length > 0 ? eventsAfterWrite : storedEvents
      ).find((event: StoredEvent): boolean => {
        return event.id === findOneById.id.toString();
      });

      return record ? rowOf(record, findOneById.select) : null;
    }) as never,
  );

  // The "Resources Affected" read: one per relation, after the write.
  resourceReads = getJestMockFunction();
  resourceReads.mockImplementation(
    async (findAllBy: {
      select: Dictionary<unknown>;
    }): Promise<Array<JSONObject>> => {
      const record: StoredEvent = (
        eventsAfterWrite.length > 0 ? eventsAfterWrite : storedEvents
      )[0]!;

      const row: JSONObject = {
        _id: record.id,
        projectId: PROJECT_ID as unknown as JSONObject,
      };

      if (findAllBy.select["hosts"]) {
        row["hosts"] = record.hostIds.map((id: string): JSONObject => {
          return {
            _id: id,
            name: HOST_NAMES[id] || "",
            projectId: PROJECT_ID as unknown as JSONObject,
          };
        });
      }

      return [row];
    },
  );
  jest
    .spyOn(ScheduledMaintenanceService, "findAllBy")
    .mockImplementation(resourceReads as never);

  refreshReminders = getJestMockFunction();
  refreshReminders.mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenanceService, "refreshReminderSchedule")
    .mockImplementation(refreshReminders as never);

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(
      ScheduledMaintenanceFeedService,
      "createScheduledMaintenanceFeedItem",
    )
    .mockImplementation(feed as never);

  labelReads = getJestMockFunction();
  labelReads.mockImplementation(
    async (findBy: { query: Dictionary<unknown> }): Promise<Array<Label>> => {
      return idsAskedFor(findBy.query["_id"])
        .filter((id: string): boolean => {
          return Boolean(LABEL_NAMES[id]);
        })
        .map((id: string): Label => {
          const row: Label = new Label();
          row._id = id;
          row.name = LABEL_NAMES[id]!;
          return row;
        });
    },
  );
  jest.spyOn(LabelService, "findBy").mockImplementation(labelReads as never);

  statusPageReads = getJestMockFunction();
  statusPageReads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
    }): Promise<Array<StatusPage>> => {
      return idsAskedFor(findBy.query["_id"])
        .filter((id: string): boolean => {
          return Boolean(STATUS_PAGE_NAMES[id]);
        })
        .map((id: string): StatusPage => {
          const row: StatusPage = new StatusPage();
          row._id = id;
          row.name = STATUS_PAGE_NAMES[id]!;
          return row;
        });
    },
  );
  jest
    .spyOn(StatusPageService, "findBy")
    .mockImplementation(statusPageReads as never);

  // The monitors are named only when the list changes; none does here.
  jest.spyOn(MonitorService, "findBy").mockResolvedValue([] as never);

  jest
    .spyOn(MonitorStatusService, "findOneBy")
    .mockImplementation((async (): Promise<MonitorStatus> => {
      const monitorStatus: MonitorStatus = new MonitorStatus();
      monitorStatus._id = DEGRADED_STATUS;
      monitorStatus.name = "Degraded";
      return monitorStatus;
    }) as never);

  // A scheduled event replays no timeline; nothing to hold.
  jest
    .spyOn(ScheduledMaintenanceStateTimelineService, "findBy")
    .mockResolvedValue([] as never);

  // The reference checks have suites of their own.
  jest
    .spyOn(
      ScheduledMaintenanceService as unknown as {
        validateProjectScopedReferences: () => Promise<void>;
      },
      "validateProjectScopedReferences",
    )
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  jest
    .spyOn(
      ScheduledMaintenanceMeasurementValueService,
      "recomputeForScheduledMaintenance",
    )
    .mockResolvedValue(undefined as never);

  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * What the event holds once the update is written: the stored event with
 * every column the update writes, lists as the ids they name.
 */
function written(
  record: StoredEvent,
  data: Dictionary<unknown>,
): StoredEvent {
  const after: StoredEvent = { ...record };

  for (const [column, field] of Object.entries(LIST_COLUMNS)) {
    if (data[column] !== undefined) {
      (after as unknown as Record<string, unknown>)[field] = idsWritten(
        data[column],
      );
    }
  }

  for (const column of ["title", "description", "enableReminders"]) {
    if (data[column] !== undefined) {
      (after as unknown as Record<string, unknown>)[column] = data[column];
    }
  }

  return after;
}

async function runBeforeUpdate(
  data: Dictionary<unknown>,
  options: {
    query?: Dictionary<unknown>;
    props?: DatabaseCommonInteractionProps;
  } = {},
): Promise<OnUpdate<ScheduledMaintenance>> {
  return await hooks.onBeforeUpdate({
    query: (options.query || {
      _id: EVENT_ID,
    }) as UpdateBy<ScheduledMaintenance>["query"],
    data: data as UpdateBy<ScheduledMaintenance>["data"],
    props: options.props || editor(),
    limit: 1,
    skip: 0,
  });
}

// The whole update as DatabaseService runs it, around the write.
async function runUpdate(
  data: Dictionary<unknown>,
  options: {
    query?: Dictionary<unknown>;
    props?: DatabaseCommonInteractionProps;
    updatedIds?: Array<string>;
  } = {},
): Promise<void> {
  const onUpdate: OnUpdate<ScheduledMaintenance> = await runBeforeUpdate(
    data,
    options,
  );

  eventsAfterWrite = storedEvents.map((record: StoredEvent): StoredEvent => {
    return written(record, data);
  });

  await hooks.onUpdateSuccess(
    onUpdate,
    (options.updatedIds || [EVENT_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );

  eventsAfterWrite = [];
}

function feedMarkdown(): Array<string> {
  return feed.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
  });
}

// The one feed item the update wrote.
function onlyFeedItem(): string {
  expect(feed).toHaveBeenCalledTimes(1);
  return feedMarkdown()[0]!;
}

function expectNothing(): void {
  expect(feedMarkdown()).toEqual([]);
  expect(refreshReminders).not.toHaveBeenCalled();
}

// What the Maintenance Details card sends with every save.
function detailsCardSave(
  overrides: Dictionary<unknown> = {},
): Dictionary<unknown> {
  return {
    title: STORED_TITLE,
    startsAt: new Date(STORED_STARTS_AT),
    endsAt: new Date(STORED_ENDS_AT),
    labels: [{ _id: CHECKOUT }, { _id: PAYMENTS }],
    statusPages: [{ _id: PUBLIC_PAGE }],
    sendSubscriberNotificationsOnBeforeTheEvent: [
      reminder(1, EventInterval.Day),
      reminder(2, EventInterval.Hour),
    ],
    ...overrides,
  };
}

// What the Affected Resources card sends with every save.
function affectedResourcesCardSave(
  overrides: Dictionary<unknown> = {},
): Dictionary<unknown> {
  return {
    monitors: [{ _id: MONITOR_A }],
    changeMonitorStatusTo: { _id: DEGRADED_STATUS },
    hosts: [{ _id: HOST_1 }],
    kubernetesClusters: [],
    dockerHosts: [],
    services: [],
    networkSites: [],
    ...overrides,
  };
}

// A client that writes the whole event back: the API, a workflow, Terraform.
function wholeEventWriteBack(
  overrides: Dictionary<unknown> = {},
): Dictionary<unknown> {
  return {
    title: STORED_TITLE,
    description: STORED_DESCRIPTION,
    startsAt: STORED_STARTS_AT,
    endsAt: STORED_ENDS_AT,
    sendSubscriberNotificationsOnBeforeTheEvent: [
      reminderFromApi(2, EventInterval.Hour),
      reminderFromApi(1, EventInterval.Day),
    ],
    enableReminders: true,
    labels: [PAYMENTS, CHECKOUT],
    statusPages: [PUBLIC_PAGE],
    monitors: [MONITOR_A],
    hosts: [HOST_1],
    changeMonitorStatusToId: new ObjectID(DEGRADED_STATUS),
    ...overrides,
  };
}

describe("an update that writes back what the event holds adds nothing", () => {
  test.each([
    [
      "the Maintenance Details card saved unchanged",
      (): Dictionary<unknown> => {
        return detailsCardSave();
      },
    ],
    [
      "the Description page saved unchanged",
      (): Dictionary<unknown> => {
        return { description: STORED_DESCRIPTION };
      },
    ],
    [
      "the Affected Resources card saved unchanged",
      (): Dictionary<unknown> => {
        return affectedResourcesCardSave();
      },
    ],
    [
      "the whole event written back, as an API client, a workflow or Terraform may",
      (): Dictionary<unknown> => {
        return wholeEventWriteBack();
      },
    ],
    [
      "the Send reminders switch written as it stands",
      (): Dictionary<unknown> => {
        return { enableReminders: true };
      },
    ],
  ] as Array<[string, () => Dictionary<unknown>]>)(
    "%s: no feed item, and the reminder interval runs on",
    async (_label: string, payload: () => Dictionary<unknown>) => {
      await runUpdate(payload());

      expectNothing();
    },
  );

  test("a workflow writing the event back as OneUptime (root, in its project) adds nothing either", async () => {
    await runUpdate(wholeEventWriteBack(), {
      props: { isRoot: true, tenantId: PROJECT_ID },
    });

    expectNothing();
  });

  test("the window sent back as ISO strings, in another time zone or as Dates is the window it has", async () => {
    for (const window of [
      { startsAt: STORED_STARTS_AT, endsAt: STORED_ENDS_AT },
      {
        startsAt: "2026-11-02T10:00:00.000+01:00",
        endsAt: "2026-11-02T06:00:00-05:00",
      },
      {
        startsAt: new Date(STORED_STARTS_AT),
        endsAt: new Date(STORED_ENDS_AT),
      },
    ]) {
      await runUpdate(window);
    }

    expectNothing();
  });

  test("the reminders before the event in another order, repeated, or sent over the API are the ones it has", async () => {
    for (const reminders of [
      [reminder(2, EventInterval.Hour), reminder(1, EventInterval.Day)],
      [
        reminder(1, EventInterval.Day),
        reminder(2, EventInterval.Hour),
        reminder(1, EventInterval.Day),
      ],
      [
        reminderFromApi(1, EventInterval.Day),
        reminderFromApi(2, EventInterval.Hour),
      ],
    ]) {
      await runUpdate({
        sendSubscriberNotificationsOnBeforeTheEvent: reminders,
      });
    }

    expectNothing();
  });

  test("labels, status pages and resources in another order, repeated, in another case or as bare ids are the ones it has", async () => {
    for (const payload of [
      { labels: [{ _id: PAYMENTS }, { _id: CHECKOUT }] },
      { labels: [CHECKOUT, PAYMENTS, CHECKOUT] },
      { labels: [new ObjectID(PAYMENTS), { _id: CHECKOUT.toUpperCase() }] },
      { statusPages: [PUBLIC_PAGE.toUpperCase()] },
      { statusPages: [{ _id: PUBLIC_PAGE }, { _id: PUBLIC_PAGE }] },
      { hosts: [HOST_1], monitors: [new ObjectID(MONITOR_A)] },
    ]) {
      await runUpdate(payload);
    }

    expectNothing();
  });

  test("nothing written over nothing - labels, status pages, reminders, a description - as [] or as null, is no change", async () => {
    storedEvents = [
      storedEvent({
        labelIds: [],
        statusPageIds: [],
        reminders: null,
        description: null,
        hostIds: [],
      }),
    ];

    await runUpdate({
      labels: [],
      statusPages: null,
      sendSubscriberNotificationsOnBeforeTheEvent: [],
      description: "",
      hosts: [],
    });
    await runUpdate({
      labels: null,
      statusPages: [],
      sendSubscriberNotificationsOnBeforeTheEvent: null,
      description: null,
      hosts: null,
    });

    expectNothing();
  });

  test("text that reads the same is the same: line endings and the whitespace around it", async () => {
    await runUpdate({
      description: STORED_DESCRIPTION.replace(/\n/g, "\r\n"),
    });
    await runUpdate({ title: ` ${STORED_TITLE}\n` });

    expectNothing();
  });

  test("Send reminders written on over an event that never set it (on by default) is no change", async () => {
    storedEvents = [storedEvent({ enableReminders: null })];

    await runUpdate({ enableReminders: true });

    expectNothing();
  });
});

describe("each real change adds its own line, once", () => {
  test("a new title, saved from the Maintenance Details card with the rest unchanged, records the title alone", async () => {
    await runUpdate(detailsCardSave({ title: "Database upgrade, part two" }));

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain("**Scheduled Maintenance was updated.**");
    expect(markdown).toContain(`${TITLE_HEADING}: \nDatabase upgrade, part two\n`);

    for (const heading of ALL_HEADINGS) {
      if (heading !== TITLE_HEADING) {
        expect(markdown).not.toContain(heading);
      }
    }

    // Neither the labels nor the switch changed: the interval runs on.
    expect(refreshReminders).not.toHaveBeenCalled();
  });

  test("moving the start records the start alone; the end that did not move adds nothing", async () => {
    await runUpdate(
      detailsCardSave({ startsAt: new Date("2026-11-02T08:30:00.000Z") }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(STARTS_AT_HEADING);
    expect(markdown).not.toContain(ENDS_AT_HEADING);
    expect(markdown).not.toContain(TITLE_HEADING);
    expect(refreshReminders).not.toHaveBeenCalled();
  });

  test("moving the whole window records both times", async () => {
    await runUpdate({
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
    });

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(STARTS_AT_HEADING);
    expect(markdown).toContain(ENDS_AT_HEADING);
    // In the order the feed has always listed them.
    expect(markdown.indexOf(STARTS_AT_HEADING)).toBeLessThan(
      markdown.indexOf(ENDS_AT_HEADING),
    );
  });

  test("a new description records the description alone, as the Markdown it is", async () => {
    await runUpdate({
      description: "The upgrade now includes a **failover test**.",
    });

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(
      `${DESCRIPTION_HEADING}: \nThe upgrade now includes a **failover test**.\n`,
    );
    expect(markdown).not.toContain(TITLE_HEADING);
  });

  test("a description cleared is recorded as removed", async () => {
    for (const cleared of ["", null]) {
      feed.mockClear();

      await runUpdate({ description: cleared });

      expect(onlyFeedItem()).toContain(
        `${DESCRIPTION_HEADING}: \nNo description provided.\n`,
      );
    }
  });

  test("a reminder before the event added records the reminders the event now has", async () => {
    await runUpdate(
      detailsCardSave({
        sendSubscriberNotificationsOnBeforeTheEvent: [
          reminder(1, EventInterval.Day),
          reminder(2, EventInterval.Hour),
          reminder(1, EventInterval.Week),
        ],
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(REMINDERS_HEADING);
    expect(markdown).toContain("- 1 Day");
    expect(markdown).toContain("- 2 Hours");
    expect(markdown).toContain("- 1 Week");
    expect(markdown).not.toContain(LABELS_HEADING);
  });

  test("every reminder before the event taken off says so", async () => {
    for (const cleared of [[], null]) {
      feed.mockClear();

      await runUpdate({
        sendSubscriberNotificationsOnBeforeTheEvent: cleared,
      });

      expect(onlyFeedItem()).toContain(
        `${REMINDERS_HEADING}: \nNo reminders before the event.\n`,
      );
    }
  });

  test("a label added records the labels the event now has, and matches the reminder rule again", async () => {
    await runUpdate(
      detailsCardSave({
        labels: [{ _id: CHECKOUT }, { _id: PAYMENTS }, { _id: EU_WEST }],
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(
      `${LABELS_HEADING}:\n\n- checkout\n- eu-west\n- payments\n`,
    );
    expect(markdown).not.toContain(TITLE_HEADING);
    expect(markdown).not.toContain(STATUS_PAGES_HEADING);

    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });

  test("every label taken off is recorded as such, as [] or as null, and matches the rule again", async () => {
    for (const cleared of [[], null]) {
      feed.mockClear();
      refreshReminders.mockClear();

      await runUpdate({ labels: cleared });

      expect(onlyFeedItem()).toContain(
        `${LABELS_HEADING}: \nAll labels removed.\n`,
      );
      expect(refreshReminders).toHaveBeenCalledTimes(1);
    }
  });

  test("a status page added records the pages the event is now shown on", async () => {
    await runUpdate(
      detailsCardSave({
        statusPages: [{ _id: PUBLIC_PAGE }, { _id: INTERNAL_PAGE }],
      }),
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(
      `${STATUS_PAGES_HEADING}:\n\n- Internal status page\n- Public status page\n`,
    );
    expect(markdown).not.toContain(LABELS_HEADING);
    expect(refreshReminders).not.toHaveBeenCalled();
  });

  test("taken off every status page says so", async () => {
    await runUpdate({ statusPages: [] });

    expect(onlyFeedItem()).toContain(
      `${STATUS_PAGES_HEADING}: \nNot shown on any status page.\n`,
    );
  });

  test("a resource added records what the event now affects", async () => {
    await runUpdate(
      affectedResourcesCardSave({ hosts: [{ _id: HOST_1 }, { _id: HOST_2 }] }),
    );

    const markdown: string = onlyFeedItem();

    // Each name is plain text inside its link's own text.
    expect(markdown).toContain(
      `${RESOURCES_HEADING}:\n\n- [Host web\\-01](${DASHBOARD}/${PROJECT_ID.toString()}/host/${HOST_1})\n- [Host web\\-02](${DASHBOARD}/${PROJECT_ID.toString()}/host/${HOST_2})\n`,
    );
    // The status it changes its monitors to was sent back unchanged.
    expect(markdown).not.toContain(MONITOR_STATUS_HEADING);
  });

  test("the last resource taken off leaves no list to show, as before", async () => {
    storedEvents = [storedEvent({ monitorIds: [] })];

    await runUpdate({ hosts: [] });

    // What the event now affects is read back - and is nothing.
    expect(resourceReads).toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });

  test.each([
    ["off", true, false],
    ["on", false, true],
  ] as Array<[string, boolean, boolean]>)(
    "Send reminders switched %s matches the reminder rule again, and adds no feed item",
    async (_label: string, stored: boolean, writtenValue: boolean) => {
      storedEvents = [storedEvent({ enableReminders: stored })];

      await runUpdate({ enableReminders: writtenValue });

      expect(refreshReminders).toHaveBeenCalledTimes(1);
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("a whole-event write-back that changes one field records that field alone", async () => {
    await runUpdate(wholeEventWriteBack({ endsAt: "2026-11-02T12:00:00Z" }));

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain(ENDS_AT_HEADING);

    for (const heading of ALL_HEADINGS) {
      if (heading !== ENDS_AT_HEADING) {
        expect(markdown).not.toContain(heading);
      }
    }

    expect(refreshReminders).not.toHaveBeenCalled();
  });

  test("several changes in one update make one feed item, with one line each, and one reminder refresh", async () => {
    await runUpdate(
      detailsCardSave({
        title: "Database upgrade, part two",
        labels: [{ _id: EU_WEST }],
        statusPages: [{ _id: INTERNAL_PAGE }],
      }),
      {},
    );

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain("Database upgrade, part two");
    expect(markdown).toContain("- eu-west");
    expect(markdown).toContain("- Internal status page");
    expect(markdown).not.toContain(STARTS_AT_HEADING);
    expect(markdown).not.toContain(REMINDERS_HEADING);

    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });
});

describe("the read before the write", () => {
  // The reads of the event's own columns: as root, in the caller's project.
  function storedReads(): Array<{
    query: Dictionary<unknown>;
    select: Dictionary<unknown>;
    props: DatabaseCommonInteractionProps;
  }> {
    return reads.mock.calls
      .map((call: Array<unknown>) => {
        return call[0] as {
          query: Dictionary<unknown>;
          select: Dictionary<unknown>;
          props: DatabaseCommonInteractionProps;
        };
      })
      .filter((read: { select: Dictionary<unknown> }): boolean => {
        return [
          "title",
          "description",
          "startsAt",
          "endsAt",
          "sendSubscriberNotificationsOnBeforeTheEvent",
          "enableReminders",
          "labels",
        ].some((column: string): boolean => {
          return read.select[column] !== undefined;
        });
      });
  }

  test("is one read, of the event's own columns the update writes and no others", async () => {
    await runBeforeUpdate({ title: "x", labels: [], enableReminders: false });

    expect(storedReads()).toHaveLength(1);
    expect(storedReads()[0]!.select).toEqual({
      _id: true,
      projectId: true,
      title: true,
      labels: { _id: true },
      enableReminders: true,
    });

    reads.mockClear();

    await runBeforeUpdate({
      startsAt: STORED_STARTS_AT,
      sendSubscriberNotificationsOnBeforeTheEvent: [],
    });

    expect(storedReads()).toHaveLength(1);
    expect(storedReads()[0]!.select).toEqual({
      _id: true,
      projectId: true,
      startsAt: true,
      sendSubscriberNotificationsOnBeforeTheEvent: true,
    });
  });

  test("is the same one read the Change Monitor Status to is checked with", async () => {
    await runBeforeUpdate({
      title: "x",
      changeMonitorStatusToId: DEGRADED_STATUS,
    });

    const statusReads: Array<{ select: Dictionary<unknown> }> =
      reads.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as { select: Dictionary<unknown> };
        })
        .filter((read: { select: Dictionary<unknown> }): boolean => {
          return read.select["changeMonitorStatusToId"] !== undefined;
        });

    expect(storedReads()).toHaveLength(1);
    expect(statusReads).toHaveLength(1);
    expect(storedReads()[0]!.select["title"]).toBe(true);
    expect(storedReads()[0]!.select["changeMonitorStatusToId"]).toBe(true);
  });

  test("each list is read on its own, never two in one read", async () => {
    await runBeforeUpdate(detailsCardSave());

    const listReads: Array<Array<string>> = reads.mock.calls.map(
      (call: Array<unknown>): Array<string> => {
        const select: Dictionary<unknown> = (
          call[0] as { select: Dictionary<unknown> }
        ).select;

        return Object.keys(select).filter((column: string): boolean => {
          return Boolean(select[column]) && typeof select[column] === "object";
        });
      },
    );

    for (const columns of listReads) {
      expect(
        columns.filter((column: string): boolean => {
          return column !== "currentScheduledMaintenanceState";
        }).length,
      ).toBeLessThanOrEqual(1);
    }
  });

  test("is made as root, within the update's query and the caller's project", async () => {
    await runBeforeUpdate({ description: "x" });

    const read: {
      query: Dictionary<unknown>;
      props: DatabaseCommonInteractionProps;
    } = storedReads()[0]!;

    expect(read.props).toEqual({ isRoot: true });
    expect(read.query["_id"]).toBe(EVENT_ID);
    expect(read.query["projectId"]).toBe(PROJECT_ID);
  });

  test("is not made for an update that writes none of those columns", async () => {
    await runBeforeUpdate({
      shouldStatusPageSubscribersBeNotifiedOnEventCreated: false,
    });

    expect(storedReads()).toHaveLength(0);
  });

  test("an event the read did not see counts as changed, so a real change is never missed", async () => {
    await runUpdate(
      { title: STORED_TITLE },
      { updatedIds: [EVENT_ID, SECOND_EVENT_ID] },
    );

    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      String(
        (feed.mock.calls[0]![0] as Record<string, unknown>)[
          "scheduledMaintenanceId"
        ],
      ),
    ).toBe(SECOND_EVENT_ID);
  });

  test("one update over two events records the change only where it is one", async () => {
    storedEvents = [
      storedEvent(),
      storedEvent({ id: SECOND_EVENT_ID, labelIds: [EU_WEST] }),
    ];

    await runUpdate(
      { labels: [{ _id: CHECKOUT }, { _id: PAYMENTS }] },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [EVENT_ID, SECOND_EVENT_ID],
      },
    );

    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      String(
        (feed.mock.calls[0]![0] as Record<string, unknown>)[
          "scheduledMaintenanceId"
        ],
      ),
    ).toBe(SECOND_EVENT_ID);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(
      String(
        (refreshReminders.mock.calls[0]![0] as Record<string, unknown>)[
          "scheduledMaintenanceId"
        ],
      ),
    ).toBe(SECOND_EVENT_ID);
  });
});

describe("the feed lines themselves", () => {
  test("quote a new title inertly, so it cannot become a link or an image", async () => {
    await runUpdate({
      title:
        "![pixel](https://tracker.example/p.png) [Reset](https://evil.example)",
    });

    const markdown: string = onlyFeedItem();

    expect(markdown).not.toContain("![pixel](");
    expect(markdown).not.toContain("[Reset](");
    expect(markdown).toContain("\\[Reset\\]");
  });

  test("name the labels and the status pages by reading them within the event's project", async () => {
    await runUpdate({
      labels: [{ _id: EU_WEST }],
      statusPages: [{ _id: INTERNAL_PAGE }],
    });

    for (const spy of [labelReads, statusPageReads]) {
      expect(spy).toHaveBeenCalledTimes(1);

      const read: {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      } = spy.mock.calls[0]![0] as {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      };

      expect(read.query["projectId"]).toEqual(PROJECT_ID);
      expect(read.props).toEqual({ isRoot: true });
    }
  });

  test("quote label and status page names inertly", async () => {
    LABEL_NAMES[EU_WEST] = "[eu](https://evil.example)";
    STATUS_PAGE_NAMES[INTERNAL_PAGE] = "<img src=x> [ops](https://evil.example)";

    try {
      await runUpdate({
        labels: [{ _id: EU_WEST }],
        statusPages: [{ _id: INTERNAL_PAGE }],
      });

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain("- \\[eu\\](https://evil.example)");
      expect(markdown).toContain(
        "- \\<img src=x> \\[ops\\](https://evil.example)",
      );
    } finally {
      LABEL_NAMES[EU_WEST] = "eu-west";
      STATUS_PAGE_NAMES[INTERNAL_PAGE] = "Internal status page";
    }
  });

  test("list the lines in the order the feed has always used", async () => {
    await runUpdate({
      title: "Database upgrade, part two",
      startsAt: "2026-11-03T09:00:00.000Z",
      endsAt: "2026-11-03T11:00:00.000Z",
      description: "New plan.",
      sendSubscriberNotificationsOnBeforeTheEvent: [
        reminder(3, EventInterval.Day),
      ],
      hosts: [{ _id: HOST_2 }],
      statusPages: [{ _id: INTERNAL_PAGE }],
      labels: [{ _id: EU_WEST }],
    });

    const markdown: string = onlyFeedItem();

    const positions: Array<number> = [
      TITLE_HEADING,
      STARTS_AT_HEADING,
      ENDS_AT_HEADING,
      DESCRIPTION_HEADING,
      REMINDERS_HEADING,
      RESOURCES_HEADING,
      STATUS_PAGES_HEADING,
      LABELS_HEADING,
    ].map((heading: string): number => {
      return markdown.indexOf(heading);
    });

    for (const position of positions) {
      expect(position).toBeGreaterThan(-1);
    }

    expect([...positions].sort((a: number, b: number): number => {
      return a - b;
    })).toEqual(positions);
  });
});
