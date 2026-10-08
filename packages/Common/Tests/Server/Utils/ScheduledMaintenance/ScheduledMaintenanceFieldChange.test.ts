import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import ScheduledMaintenanceFieldChange, {
  REMINDERS_BEFORE_THE_EVENT_COLUMN,
  ScheduledMaintenanceFieldSet,
  ScheduledMaintenanceValuesBeforeUpdate,
} from "../../../../Server/Utils/ScheduledMaintenance/ScheduledMaintenanceFieldChange";
import OneUptimeDate from "../../../../Types/Date";
import Dictionary from "../../../../Types/Dictionary";
import EventInterval from "../../../../Types/Events/EventInterval";
import Recurring from "../../../../Types/Events/Recurring";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What an update really changes on a scheduled maintenance event: its
 * title, its window, its description, the reminders its subscribers get
 * before it starts, its labels and its Send reminders switch, compared with
 * what it held before the write (ScheduledMaintenanceService reads that in
 * its one stored read; ScheduledMaintenanceUpdatedFeedRealChanges runs the
 * hooks). The "updated" feed item has a line for each one that changed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-f1e1-4aaa-8bbb-000000000001",
);
const STATUS_PAGE_PUBLIC: string = "0193c0de-f1e1-4aaa-8bbb-0000000000d1";
const STATUS_PAGE_INTERNAL: string = "0193c0de-f1e1-4aaa-8bbb-0000000000d2";
const LABEL_DATABASE: string = "0193c0de-f1e1-4aaa-8bbb-0000000000e1";
const LABEL_EU: string = "0193c0de-f1e1-4aaa-8bbb-0000000000e2";

const STARTS_AT: Date = new Date(Date.UTC(2026, 9, 10, 22, 0, 0));
const ENDS_AT: Date = new Date(Date.UTC(2026, 9, 11, 2, 0, 0));

const NOTHING: ScheduledMaintenanceFieldSet = {
  textColumns: [],
  labels: false,
  enableReminders: false,
  timeColumns: [],
  remindersBeforeTheEvent: false,
};

function reminder(count: number, interval: EventInterval): Recurring {
  const recurring: Recurring = new Recurring();
  recurring.intervalCount = new PositiveNumber(count);
  recurring.intervalType = interval;
  return recurring;
}

// The same reminder as the API and a workflow send it: its JSON.
function reminderJson(count: number, interval: EventInterval): JSONObject {
  return reminder(count, interval).toJSON();
}

function label(id: string): Label {
  const row: Label = new Label();
  row._id = id;
  return row;
}

describe("ScheduledMaintenanceFieldChange.getFieldsWritten", () => {
  test("a column left out, or sent as undefined, is not written", () => {
    expect(ScheduledMaintenanceFieldChange.getFieldsWritten({})).toEqual(
      NOTHING,
    );
    expect(ScheduledMaintenanceFieldChange.getFieldsWritten(null)).toEqual(
      NOTHING,
    );
    expect(
      ScheduledMaintenanceFieldChange.getFieldsWritten({
        title: undefined,
        startsAt: undefined,
        [REMINDERS_BEFORE_THE_EVENT_COLUMN]: undefined,
      }),
    ).toEqual(NOTHING);
    expect(ScheduledMaintenanceFieldChange.isAnySet(NOTHING)).toBe(false);
  });

  test("names every compared column the Maintenance Details card sends", () => {
    expect(
      ScheduledMaintenanceFieldChange.getFieldsWritten({
        title: "Database upgrade",
        description: "x",
        endsAt: ENDS_AT,
        startsAt: STARTS_AT,
        labels: [],
        enableReminders: true,
        [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [],
      }),
    ).toEqual({
      textColumns: ["title", "description"],
      labels: true,
      enableReminders: true,
      timeColumns: ["startsAt", "endsAt"],
      remindersBeforeTheEvent: true,
    });
  });

  test("an incident's columns and the lists the service compares are not compared here", () => {
    expect(
      ScheduledMaintenanceFieldChange.getFieldsWritten({
        rootCause: "x",
        remediationNotes: "x",
        name: "x",
        statusPages: [],
        monitors: [],
        changeMonitorStatusToId: new ObjectID(STATUS_PAGE_PUBLIC),
      }),
    ).toEqual(NOTHING);
  });

  test("any of them written is something to read", () => {
    expect(
      ScheduledMaintenanceFieldChange.isAnySet({
        ...NOTHING,
        timeColumns: ["endsAt"],
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceFieldChange.isAnySet({
        ...NOTHING,
        remindersBeforeTheEvent: true,
      }),
    ).toBe(true);
    expect(
      ScheduledMaintenanceFieldChange.isAnySet({ ...NOTHING, labels: true }),
    ).toBe(true);
  });
});

describe("ScheduledMaintenanceFieldChange.getSelect", () => {
  test("asks for the columns the update writes and no others", () => {
    expect(
      ScheduledMaintenanceFieldChange.getSelect(
        ScheduledMaintenanceFieldChange.getFieldsWritten({
          title: "x",
          startsAt: STARTS_AT,
          labels: [],
          [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [],
        }),
      ),
    ).toEqual({
      title: true,
      startsAt: true,
      labels: { _id: true },
      [REMINDERS_BEFORE_THE_EVENT_COLUMN]: true,
    });

    expect(ScheduledMaintenanceFieldChange.getSelect(NOTHING)).toEqual({});
  });
});

describe("ScheduledMaintenanceFieldChange.getValuesBeforeUpdate", () => {
  test("holds each column the update writes: times as instants, reminders as a set", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Database upgrade";
    event.startsAt = STARTS_AT;
    event.sendSubscriberNotificationsOnBeforeTheEvent = [
      reminder(2, EventInterval.Hour),
      reminder(1, EventInterval.Day),
      reminder(2, EventInterval.Hour),
    ];
    event.labels = [label(LABEL_EU), label(LABEL_DATABASE)];

    expect(
      ScheduledMaintenanceFieldChange.getValuesBeforeUpdate({
        record: event,
        fields: ScheduledMaintenanceFieldChange.getFieldsWritten({
          title: "x",
          startsAt: STARTS_AT,
          endsAt: ENDS_AT,
          labels: [],
          [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [],
        }),
      }),
    ).toEqual({
      title: "Database upgrade",
      startsAt: STARTS_AT.getTime(),
      // The event had no end time: held as none, not as unread.
      endsAt: null,
      labelIds: [LABEL_DATABASE, LABEL_EU],
      remindersBeforeTheEvent: ["1 Day", "2 Hour"],
    });
  });

  test("leaves out the columns the update does not write", () => {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event.title = "Database upgrade";
    event.startsAt = STARTS_AT;

    expect(
      ScheduledMaintenanceFieldChange.getValuesBeforeUpdate({
        record: event,
        fields: ScheduledMaintenanceFieldChange.getFieldsWritten({
          endsAt: ENDS_AT,
        }),
      }),
    ).toEqual({ endsAt: null });
  });
});

describe("ScheduledMaintenanceFieldChange.getChanges", () => {
  const before: ScheduledMaintenanceValuesBeforeUpdate = {
    title: "Database upgrade",
    description: "We upgrade the primary.",
    startsAt: STARTS_AT.getTime(),
    endsAt: ENDS_AT.getTime(),
    remindersBeforeTheEvent: ["1 Day", "2 Hour"],
    labelIds: [LABEL_DATABASE, LABEL_EU],
    enableReminders: true,
  };

  // The event as the Maintenance Details card sends it back, unchanged.
  function writtenBack(): Dictionary<unknown> {
    return {
      title: "Database upgrade\n",
      description: "We upgrade the primary.\r\n",
      // The same instants, written another way each.
      startsAt: "2026-10-11T00:00:00.000+02:00",
      endsAt: new Date(ENDS_AT.getTime()),
      // The same reminders, in another order, one twice, as JSON.
      [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [
        reminderJson(2, EventInterval.Hour),
        reminderJson(1, EventInterval.Day),
        reminderJson(2, EventInterval.Hour),
      ],
      labels: [LABEL_EU.toUpperCase(), label(LABEL_DATABASE)],
      enableReminders: true,
    };
  }

  test("the whole event written back changes nothing", () => {
    expect(
      ScheduledMaintenanceFieldChange.getChanges({
        written: writtenBack(),
        valuesBeforeUpdate: before,
      }),
    ).toEqual(NOTHING);
  });

  test.each([
    [
      "the title",
      { title: "Database and cache upgrade" },
      { textColumns: ["title"] },
    ],
    [
      "the description",
      { description: "We upgrade the primary and the replica." },
      { textColumns: ["description"] },
    ],
    [
      "the start, an hour later",
      { startsAt: new Date(STARTS_AT.getTime() + 3_600_000) },
      { timeColumns: ["startsAt"] },
    ],
    [
      "the end, a minute later",
      { endsAt: "2026-10-11T02:01:00.000Z" },
      { timeColumns: ["endsAt"] },
    ],
    [
      "a reminder added",
      {
        [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [
          reminderJson(1, EventInterval.Week),
          reminderJson(1, EventInterval.Day),
          reminderJson(2, EventInterval.Hour),
        ],
      },
      { remindersBeforeTheEvent: true },
    ],
    [
      "a reminder's time changed",
      {
        [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [
          reminderJson(1, EventInterval.Day),
          reminderJson(3, EventInterval.Hour),
        ],
      },
      { remindersBeforeTheEvent: true },
    ],
    [
      "every reminder taken off",
      { [REMINDERS_BEFORE_THE_EVENT_COLUMN]: null },
      { remindersBeforeTheEvent: true },
    ],
    ["a label taken off", { labels: [LABEL_DATABASE] }, { labels: true }],
    [
      "Send reminders switched off",
      { enableReminders: false },
      { enableReminders: true },
    ],
  ] as Array<
    [string, Dictionary<unknown>, Partial<ScheduledMaintenanceFieldSet>]
  >)(
    "%s changes that, and nothing else",
    (
      _label: string,
      change: Dictionary<unknown>,
      changed: Partial<ScheduledMaintenanceFieldSet>,
    ) => {
      expect(
        ScheduledMaintenanceFieldChange.getChanges({
          written: { ...writtenBack(), ...change },
          valuesBeforeUpdate: before,
        }),
      ).toEqual({ ...NOTHING, ...changed });
    },
  );

  test("an event the read did not see: everything the update writes counts as changed", () => {
    expect(
      ScheduledMaintenanceFieldChange.getChanges({
        written: writtenBack(),
        valuesBeforeUpdate: undefined,
      }),
    ).toEqual({
      textColumns: ["title", "description"],
      labels: true,
      enableReminders: true,
      timeColumns: ["startsAt", "endsAt"],
      remindersBeforeTheEvent: true,
    });
  });

  test("a column the read did not hold counts as changed", () => {
    expect(
      ScheduledMaintenanceFieldChange.getChanges({
        written: { endsAt: ENDS_AT },
        valuesBeforeUpdate: { title: "Database upgrade" },
      }).timeColumns,
    ).toEqual(["endsAt"]);
  });
});

describe("ScheduledMaintenanceFieldChange reminders before the event", () => {
  test("a reminder reads as its count and interval, as a Recurring or as its JSON", () => {
    expect(
      ScheduledMaintenanceFieldChange.getReminderKey(
        reminder(1, EventInterval.Day),
      ),
    ).toBe("1 Day");
    expect(
      ScheduledMaintenanceFieldChange.getReminderKey(
        reminderJson(2, EventInterval.Hour),
      ),
    ).toBe("2 Hour");
  });

  test("an entry that is no reminder has no key", () => {
    for (const entry of [
      "1 Day",
      {},
      { _type: "Recurring" },
      { intervalType: "Day", intervalCount: 1 },
      null,
    ]) {
      expect(ScheduledMaintenanceFieldChange.getReminderKey(entry)).toBeNull();
    }
  });

  test("a list reads as its reminders, each once, the longest before the event first", () => {
    expect(
      ScheduledMaintenanceFieldChange.normalizeReminderList([
        reminderJson(1, EventInterval.Day),
        reminder(2, EventInterval.Hour),
        reminderJson(1, EventInterval.Week),
        reminderJson(2, EventInterval.Day),
        reminder(1, EventInterval.Day),
      ]),
    ).toEqual(["1 Week", "2 Day", "1 Day", "2 Hour"]);
  });

  test("a list cleared to null names none, as [] does; empty entries are skipped", () => {
    expect(ScheduledMaintenanceFieldChange.normalizeReminderList(null)).toEqual(
      [],
    );
    expect(
      ScheduledMaintenanceFieldChange.normalizeReminderList(undefined),
    ).toEqual([]);
    expect(
      ScheduledMaintenanceFieldChange.normalizeReminderList([null, undefined]),
    ).toEqual([]);
  });

  test("an entry that is no reminder is kept, as its JSON, after the reminders", () => {
    expect(
      ScheduledMaintenanceFieldChange.normalizeReminderList([
        { odd: true },
        reminderJson(1, EventInterval.Day),
      ]),
    ).toEqual(["1 Day", '{"odd":true}']);
  });

  test.each([
    ["the same reminders", ["1 Day", "2 Hour"], false],
    ["no reminders over none", [], false],
    ["one more", ["1 Week", "1 Day", "2 Hour"], true],
    ["one fewer", ["1 Day"], true],
    ["another one", ["1 Day", "3 Hour"], true],
  ] as Array<[string, Array<string>, boolean]>)(
    "%s",
    (_label: string, keysBefore: Array<string>, changed: boolean) => {
      const written: Array<JSONObject> = [
        reminderJson(2, EventInterval.Hour),
        reminderJson(1, EventInterval.Day),
      ];

      expect(
        ScheduledMaintenanceFieldChange.isReminderListChanged({
          writtenList: keysBefore.length === 0 ? [] : written,
          remindersBeforeUpdate:
            keysBefore.length === 0
              ? []
              : ScheduledMaintenanceFieldChange.normalizeReminderList(
                  keysBefore.map((key: string): JSONObject => {
                    const [count, interval] = key.split(" ") as [
                      string,
                      EventInterval,
                    ];
                    return reminderJson(Number(count), interval);
                  }),
                ),
        }),
      ).toBe(changed);
    },
  );

  test("null and [] both clear them: neither changes an event that had none", () => {
    expect(
      ScheduledMaintenanceFieldChange.isReminderListChanged({
        writtenList: null,
        remindersBeforeUpdate: [],
      }),
    ).toBe(false);
  });

  test("a list left out is not changed; an event the read did not see is", () => {
    expect(
      ScheduledMaintenanceFieldChange.isReminderListChanged({
        writtenList: undefined,
        remindersBeforeUpdate: ["1 Day"],
      }),
    ).toBe(false);
    expect(
      ScheduledMaintenanceFieldChange.isReminderListChanged({
        writtenList: [],
        remindersBeforeUpdate: undefined,
      }),
    ).toBe(true);
  });
});

describe("ScheduledMaintenanceFieldChange.getFeedMarkdown", () => {
  function markdownOf(
    written: Dictionary<unknown>,
    changes: Partial<ScheduledMaintenanceFieldSet>,
  ): string {
    return ScheduledMaintenanceFieldChange.getFeedMarkdown({
      written: written,
      changes: { ...NOTHING, ...changes },
    }).toString();
  }

  function shownTime(date: Date): string {
    return OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date);
  }

  test("nothing changed is no line", () => {
    expect(
      markdownOf({ title: "x", startsAt: STARTS_AT, description: "x" }, {}),
    ).toBe("");
  });

  test("lists the changed fields in the feed's order, each with the value written", () => {
    expect(
      markdownOf(
        {
          [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [
            reminderJson(2, EventInterval.Hour),
            reminderJson(1, EventInterval.Day),
          ],
          description: "We upgrade the **primary**.",
          endsAt: ENDS_AT.toISOString(),
          startsAt: STARTS_AT,
          title: "Database upgrade",
        },
        {
          textColumns: ["title", "description"],
          timeColumns: ["startsAt", "endsAt"],
          remindersBeforeTheEvent: true,
        },
      ),
    ).toBe(
      "\n\n**Title**: \nDatabase upgrade\n" +
        `\n\n**Starts At**: \n${shownTime(STARTS_AT)}\n` +
        `\n\n**Ends At**: \n${shownTime(ENDS_AT)}\n` +
        "\n\n**Scheduled Maintenance Description**: \nWe upgrade the **primary**.\n" +
        "\n\n**Notify Subscribers Before Event Starts**:\n\n- 1 Day\n- 2 Hours\n",
    );
  });

  test("the title is quoted inertly; the description is Markdown, shown as written", () => {
    const markdown: string = markdownOf(
      {
        title: "Upgrade [now](https://evil.example) <img>",
        description: "See the [runbook](https://runbooks.example/db).",
      },
      { textColumns: ["title", "description"] },
    );

    expect(markdown).toContain(
      "Upgrade \\[now\\](https://evil.example) \\<img>",
    );
    expect(markdown).toContain(
      "See the [runbook](https://runbooks.example/db).",
    );
  });

  test("each reminder is worded as the dashboard words it", () => {
    expect(
      markdownOf(
        {
          [REMINDERS_BEFORE_THE_EVENT_COLUMN]: [
            reminder(1, EventInterval.Hour),
            reminder(3, EventInterval.Week),
            reminder(1, EventInterval.Month),
            reminder(2, EventInterval.Year),
            { odd: true },
          ],
        },
        { remindersBeforeTheEvent: true },
      ),
    ).toBe(
      "\n\n**Notify Subscribers Before Event Starts**:\n\n- 2 Years\n- 1 Month\n- 3 Weeks\n- 1 Hour\n",
    );
  });

  test("a field emptied says so", () => {
    expect(markdownOf({ title: " " }, { textColumns: ["title"] })).toBe(
      "\n\n**Title**: \nNo title provided.\n",
    );
    expect(
      markdownOf({ description: null }, { textColumns: ["description"] }),
    ).toBe(
      "\n\n**Scheduled Maintenance Description**: \nNo description provided.\n",
    );
    expect(markdownOf({ endsAt: null }, { timeColumns: ["endsAt"] })).toBe(
      "\n\n**Ends At**: \nNo time provided.\n",
    );
    for (const cleared of [[], null]) {
      expect(
        markdownOf(
          { [REMINDERS_BEFORE_THE_EVENT_COLUMN]: cleared },
          { remindersBeforeTheEvent: true },
        ),
      ).toBe(
        "\n\n**Notify Subscribers Before Event Starts**: \nNo reminders before the event.\n",
      );
    }
  });
});

describe("ScheduledMaintenanceFieldChange.getStatusPagesMarkdown", () => {
  let statusPageReads: MockFunction;
  let statusPageNames: Record<string, string> = {};

  beforeEach(() => {
    statusPageNames = {
      [STATUS_PAGE_PUBLIC]: "Public status",
      [STATUS_PAGE_INTERNAL]: "Internal status",
    };

    statusPageReads = getJestMockFunction();
    statusPageReads.mockImplementation(
      async (findBy: {
        query: Dictionary<unknown>;
      }): Promise<Array<StatusPage>> => {
        const operator: { objectLiteralParameters?: Dictionary<unknown> } =
          findBy.query["_id"] as {
            objectLiteralParameters?: Dictionary<unknown>;
          };

        return (
          Object.values(operator.objectLiteralParameters || {}) as Array<
            Array<string>
          >
        )
          .flat()
          .filter((id: string): boolean => {
            return Boolean(statusPageNames[id]);
          })
          .map((id: string): StatusPage => {
            const row: StatusPage = new StatusPage();
            row._id = id;
            row.name = statusPageNames[id]!;
            return row;
          });
      },
    );
    jest
      .spyOn(StatusPageService, "findBy")
      .mockImplementation(statusPageReads as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("names the pages in name order, read as root within the project", async () => {
    expect(
      (
        await ScheduledMaintenanceFieldChange.getStatusPagesMarkdown({
          writtenStatusPages: [STATUS_PAGE_PUBLIC, STATUS_PAGE_INTERNAL],
          projectId: PROJECT_ID,
        })
      ).toString(),
    ).toBe(
      "\n\n**Shown on Status Pages**:\n\n- Internal status\n- Public status\n",
    );

    expect(statusPageReads).toHaveBeenCalledTimes(1);

    const read: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    } = statusPageReads.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    };

    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({ name: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("page names are quoted inertly", async () => {
    statusPageNames[STATUS_PAGE_PUBLIC] = "[Status](https://evil.example) <b>";

    expect(
      (
        await ScheduledMaintenanceFieldChange.getStatusPagesMarkdown({
          writtenStatusPages: [{ _id: STATUS_PAGE_PUBLIC }],
          projectId: PROJECT_ID,
        })
      ).toString(),
    ).toContain("- \\[Status\\](https://evil.example) \\<b>");
  });

  test("taken off every page says so, without reading any", async () => {
    for (const cleared of [[], null]) {
      expect(
        (
          await ScheduledMaintenanceFieldChange.getStatusPagesMarkdown({
            writtenStatusPages: cleared,
            projectId: PROJECT_ID,
          })
        ).toString(),
      ).toBe(
        "\n\n**Shown on Status Pages**: \nNot shown on any status page.\n",
      );
    }

    expect(statusPageReads).not.toHaveBeenCalled();
  });

  test("pages none of which can be read any more make no line", async () => {
    statusPageNames = {};

    expect(
      (
        await ScheduledMaintenanceFieldChange.getStatusPagesMarkdown({
          writtenStatusPages: [STATUS_PAGE_PUBLIC],
          projectId: PROJECT_ID,
        })
      ).toString(),
    ).toBe("");
  });
});
