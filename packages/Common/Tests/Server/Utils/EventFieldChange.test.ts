import Label from "../../../Models/DatabaseModels/Label";
import Incident from "../../../Models/DatabaseModels/Incident";
import LabelService from "../../../Server/Services/LabelService";
import EventFieldChange, {
  EventFieldSet,
  EventValuesBeforeUpdate,
  INCIDENT_OR_ALERT_FIELDS,
  MONITOR_FIELDS,
  SCHEDULED_MAINTENANCE_FIELDS,
} from "../../../Server/Utils/EventFieldChange";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What an update really changes on an incident or an alert: the title, the
 * root cause, the description, the remediation notes, the labels and the
 * Send reminders switch, compared with what the record held before the
 * write. The "updated" feed item records each one that changed, and a
 * labels change or the switch flipped matches the reminder rule again
 * (IncidentService, AlertService; UpdatedFeedRealChanges runs both hooks).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-f1e1-4aaa-8bbb-000000000001",
);
const CHECKOUT: string = "0193c0de-f1e1-4aaa-8bbb-0000000000c1";
const PAYMENTS: string = "0193c0de-f1e1-4aaa-8bbb-0000000000c2";
const EU_WEST: string = "0193c0de-f1e1-4aaa-8bbb-0000000000c3";

const NOTHING: EventFieldSet = {
  textColumns: [],
  labels: false,
  enableReminders: false,
};

function label(id: string): Label {
  const row: Label = new Label();
  row._id = id;
  return row;
}

describe("EventFieldChange.getFieldsWritten", () => {
  test("a column left out, or sent as undefined, is not written", () => {
    expect(EventFieldChange.getFieldsWritten({})).toEqual(NOTHING);
    expect(EventFieldChange.getFieldsWritten(undefined)).toEqual(NOTHING);
    expect(EventFieldChange.getFieldsWritten(null)).toEqual(NOTHING);
    expect(
      EventFieldChange.getFieldsWritten({
        title: undefined,
        labels: undefined,
        enableReminders: undefined,
      }),
    ).toEqual(NOTHING);
  });

  test("a column sent as null or empty is written: it empties it", () => {
    expect(
      EventFieldChange.getFieldsWritten({
        rootCause: null,
        description: "",
        labels: null,
        enableReminders: false,
      }),
    ).toEqual({
      textColumns: ["rootCause", "description"],
      labels: true,
      enableReminders: true,
    });
  });

  test("lists the text columns in the order the feed shows them", () => {
    expect(
      EventFieldChange.getFieldsWritten({
        remediationNotes: "x",
        description: "x",
        rootCause: "x",
        title: "x",
      }).textColumns,
    ).toEqual(["title", "rootCause", "description", "remediationNotes"]);
  });

  test("other columns are not compared here", () => {
    expect(
      EventFieldChange.getFieldsWritten({
        incidentSeverityId: new ObjectID(CHECKOUT),
        postmortemNote: "x",
        monitors: [],
      }),
    ).toEqual(NOTHING);
    expect(EventFieldChange.isAnySet(NOTHING)).toBe(false);
  });

  test("any of them written is something to read", () => {
    expect(
      EventFieldChange.isAnySet({ ...NOTHING, textColumns: ["title"] }),
    ).toBe(true);
    expect(EventFieldChange.isAnySet({ ...NOTHING, labels: true })).toBe(true);
    expect(
      EventFieldChange.isAnySet({ ...NOTHING, enableReminders: true }),
    ).toBe(true);
  });
});

describe("EventFieldChange.getSelect", () => {
  test("asks for the columns the update writes and no others, labels by id", () => {
    expect(
      EventFieldChange.getSelect(
        EventFieldChange.getFieldsWritten({
          title: "x",
          labels: [],
        }),
      ),
    ).toEqual({ title: true, labels: { _id: true } });

    expect(
      EventFieldChange.getSelect(
        EventFieldChange.getFieldsWritten({
          description: "x",
          remediationNotes: "x",
          enableReminders: true,
        }),
      ),
    ).toEqual({
      description: true,
      remediationNotes: true,
      enableReminders: true,
    });

    expect(EventFieldChange.getSelect(NOTHING)).toEqual({});
  });
});

describe("EventFieldChange.getValuesBeforeUpdate", () => {
  test("holds each column the update writes, as the record held it", () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout errors";
    incident.labels = [label(PAYMENTS), label(CHECKOUT.toUpperCase())];
    incident.enableReminders = false;

    expect(
      EventFieldChange.getValuesBeforeUpdate({
        record: incident,
        fields: EventFieldChange.getFieldsWritten({
          title: "x",
          labels: [],
          enableReminders: true,
        }),
      }),
    ).toEqual({
      title: "Checkout errors",
      labelIds: [CHECKOUT, PAYMENTS],
      enableReminders: false,
    });
  });

  test("a text or a switch the record did not have is held as null, not as unread", () => {
    const incident: Incident = new Incident();

    const values: EventValuesBeforeUpdate =
      EventFieldChange.getValuesBeforeUpdate({
        record: incident,
        fields: EventFieldChange.getFieldsWritten({
          rootCause: "x",
          labels: [],
          enableReminders: true,
        }),
      });

    expect(values).toEqual({
      rootCause: null,
      labelIds: [],
      enableReminders: null,
    });
    expect(Object.keys(values).sort()).toEqual([
      "enableReminders",
      "labelIds",
      "rootCause",
    ]);
  });

  test("leaves out the columns the update does not write", () => {
    const incident: Incident = new Incident();
    incident.title = "Checkout errors";
    incident.description = "Something";

    expect(
      EventFieldChange.getValuesBeforeUpdate({
        record: incident,
        fields: EventFieldChange.getFieldsWritten({ description: "x" }),
      }),
    ).toEqual({ description: "Something" });
  });
});

describe("EventFieldChange.normalizeText and isTextChanged", () => {
  test("a text reads the same whatever its line endings and surrounding whitespace", () => {
    expect(EventFieldChange.normalizeText("a\r\nb\rc\n")).toBe("a\nb\nc");
    expect(EventFieldChange.normalizeText("  spaced  ")).toBe("spaced");
    expect(EventFieldChange.normalizeText(null)).toBe("");
    expect(EventFieldChange.normalizeText(undefined)).toBe("");
    expect(EventFieldChange.normalizeText(42)).toBe("");
  });

  test.each([
    ["the same text", "Bad deploy", "Bad deploy", false],
    ["the same text with CRLF line endings", "a\r\nb", "a\nb", false],
    [
      "the same text with a trailing newline",
      "Bad deploy\n",
      "Bad deploy",
      false,
    ],
    ["an empty text over none", "", null, false],
    ["whitespace over none", "   ", null, false],
    ["null over an empty text", null, "", false],
    ["another text", "Bad config", "Bad deploy", true],
    ["a text over none", "Bad deploy", null, true],
    ["an empty text over a text", "", "Bad deploy", true],
    ["null over a text", null, "Bad deploy", true],
    ["a change inside the text", "a\n\nb", "a\nb", true],
    ["a change of case", "bad deploy", "Bad deploy", true],
  ] as Array<[string, unknown, string | null, boolean]>)(
    "%s",
    (
      _label: string,
      writtenValue: unknown,
      valueBeforeUpdate: string | null,
      changed: boolean,
    ) => {
      expect(
        EventFieldChange.isTextChanged({
          writtenValue: writtenValue,
          valueBeforeUpdate: valueBeforeUpdate,
        }),
      ).toBe(changed);
    },
  );

  test("a text left out of the update is not changed", () => {
    expect(
      EventFieldChange.isTextChanged({
        writtenValue: undefined,
        valueBeforeUpdate: "Bad deploy",
      }),
    ).toBe(false);
  });

  test("a record the read did not see counts as changed, whatever is written", () => {
    expect(
      EventFieldChange.isTextChanged({
        writtenValue: "",
        valueBeforeUpdate: undefined,
      }),
    ).toBe(true);
  });
});

describe("EventFieldChange.areRemindersOn and isRemindersSwitchChanged", () => {
  test("reminders are on unless switched off; never set is on", () => {
    expect(EventFieldChange.areRemindersOn(true)).toBe(true);
    expect(EventFieldChange.areRemindersOn(null)).toBe(true);
    expect(EventFieldChange.areRemindersOn(undefined)).toBe(true);
    expect(EventFieldChange.areRemindersOn("true")).toBe(true);
    expect(EventFieldChange.areRemindersOn(false)).toBe(false);
    expect(EventFieldChange.areRemindersOn("false")).toBe(false);
    expect(EventFieldChange.areRemindersOn(" FALSE ")).toBe(false);
  });

  test.each([
    ["on over on", true, true, false],
    ["on over never set", true, null, false],
    ["off over off", false, false, false],
    ["off over on", false, true, true],
    ["off over never set", false, null, true],
    ["on over off", true, false, true],
    ["null (on) over off", null, false, true],
  ] as Array<[string, unknown, boolean | null, boolean]>)(
    "%s",
    (
      _label: string,
      writtenValue: unknown,
      valueBeforeUpdate: boolean | null,
      changed: boolean,
    ) => {
      expect(
        EventFieldChange.isRemindersSwitchChanged({
          writtenValue: writtenValue,
          valueBeforeUpdate: valueBeforeUpdate,
        }),
      ).toBe(changed);
    },
  );

  test("the switch left out is not changed; a record the read did not see is", () => {
    expect(
      EventFieldChange.isRemindersSwitchChanged({
        writtenValue: undefined,
        valueBeforeUpdate: false,
      }),
    ).toBe(false);
    expect(
      EventFieldChange.isRemindersSwitchChanged({
        writtenValue: true,
        valueBeforeUpdate: undefined,
      }),
    ).toBe(true);
  });
});

describe("EventFieldChange.getChanges", () => {
  const before: EventValuesBeforeUpdate = {
    title: "Checkout errors",
    rootCause: null,
    description: "Customers see errors.",
    remediationNotes: "Rolled back.",
    labelIds: [CHECKOUT, PAYMENTS],
    enableReminders: true,
  };

  test("a whole record written back changes nothing", () => {
    expect(
      EventFieldChange.getChanges({
        written: {
          title: "Checkout errors",
          rootCause: "",
          description: "Customers see errors.\n",
          remediationNotes: "Rolled back.",
          labels: [PAYMENTS, CHECKOUT],
          enableReminders: true,
        },
        valuesBeforeUpdate: before,
      }),
    ).toEqual(NOTHING);
  });

  test("names each field that changed, and only those", () => {
    expect(
      EventFieldChange.getChanges({
        written: {
          title: "Checkout errors",
          rootCause: "Bad deploy",
          description: "Customers see errors.",
          remediationNotes: "",
          labels: [CHECKOUT],
          enableReminders: true,
        },
        valuesBeforeUpdate: before,
      }),
    ).toEqual({
      textColumns: ["rootCause", "remediationNotes"],
      labels: true,
      enableReminders: false,
    });
  });

  test("a record the read did not see: everything the update writes counts as changed", () => {
    expect(
      EventFieldChange.getChanges({
        written: {
          title: "Checkout errors",
          labels: [],
          enableReminders: true,
        },
        valuesBeforeUpdate: undefined,
      }),
    ).toEqual({
      textColumns: ["title"],
      labels: true,
      enableReminders: true,
    });
  });

  test("a column the read did not hold counts as changed", () => {
    // The read held the title only; the description was not read.
    expect(
      EventFieldChange.getChanges({
        written: { description: "x" },
        valuesBeforeUpdate: { title: "Checkout errors" },
      }).textColumns,
    ).toEqual(["description"]);
  });

  test("nothing written, nothing changed", () => {
    expect(
      EventFieldChange.getChanges({
        written: {},
        valuesBeforeUpdate: undefined,
      }),
    ).toEqual(NOTHING);
    expect(
      EventFieldChange.getChanges({
        written: null,
        valuesBeforeUpdate: before,
      }),
    ).toEqual(NOTHING);
  });
});

describe("EventFieldChange.getFeedMarkdown", () => {
  let labelReads: MockFunction;
  let labelNames: Record<string, string> = {};

  beforeEach(() => {
    labelNames = {
      [CHECKOUT]: "checkout",
      [PAYMENTS]: "payments",
      [EU_WEST]: "eu-west",
    };

    labelReads = getJestMockFunction();
    labelReads.mockImplementation(
      async (findBy: { query: Dictionary<unknown> }): Promise<Array<Label>> => {
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
            return Boolean(labelNames[id]);
          })
          .map((id: string): Label => {
            const row: Label = label(id);
            row.name = labelNames[id]!;
            return row;
          });
      },
    );
    jest.spyOn(LabelService, "findBy").mockImplementation(labelReads as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function markdownOf(
    written: Dictionary<unknown>,
    changes: Partial<EventFieldSet>,
    recordName: string = "Incident",
  ): Promise<string> {
    return EventFieldChange.getFeedMarkdown({
      written: written,
      changes: { ...NOTHING, ...changes },
      projectId: PROJECT_ID,
      recordName: recordName,
    });
  }

  test("nothing changed is no line, and reads no label", async () => {
    expect(
      await markdownOf(
        { title: "x", labels: [CHECKOUT], description: "x" },
        {},
      ),
    ).toBe("");
    expect(labelReads).not.toHaveBeenCalled();
  });

  test("lists the changed fields in the feed's order, each with the value written", async () => {
    const markdown: string = await markdownOf(
      {
        remediationNotes: "Rolled back.",
        description: "Customers see errors.",
        rootCause: "Bad deploy",
        title: "Checkout errors",
        labels: [CHECKOUT],
      },
      {
        textColumns: ["title", "rootCause", "description", "remediationNotes"],
        labels: true,
      },
    );

    expect(markdown).toBe(
      "\n\n**Title**: \nCheckout errors\n" +
        "\n\n**📄 Root Cause**: \nBad deploy\n" +
        "\n\n**Incident Description**: \nCustomers see errors.\n" +
        "\n\n**🎯 Remediation Notes**: \nRolled back.\n" +
        "\n\n**🏷️ Labels**:\n\n- checkout\n",
    );
  });

  test("names the description after the record", async () => {
    expect(
      await markdownOf(
        { description: "Disk is full." },
        { textColumns: ["description"] },
        "Alert",
      ),
    ).toBe("\n\n**Alert Description**: \nDisk is full.\n");
  });

  test.each([
    ["title", "No title provided."],
    ["rootCause", "Root cause removed."],
    ["description", "No description provided."],
    ["remediationNotes", "Remediation notes removed."],
  ] as Array<[string, string]>)(
    "%s emptied says so",
    async (column: string, line: string) => {
      for (const emptied of ["", "  \n ", null]) {
        expect(
          await markdownOf(
            { [column]: emptied },
            {
              textColumns: [
                column as
                  | "title"
                  | "rootCause"
                  | "description"
                  | "remediationNotes",
              ],
            },
          ),
        ).toContain(`: \n${line}\n`);
      }
    },
  );

  test("the title is quoted inertly; the Markdown fields are shown as written", async () => {
    const markdown: string = await markdownOf(
      {
        title: "![x](https://tracker.example/p.png) <b>",
        rootCause: "**Bold** [runbook](https://runbooks.example/db)",
      },
      { textColumns: ["title", "rootCause"] },
    );

    expect(markdown).toContain("!\\[x\\](https://tracker.example/p.png) \\<b>");
    expect(markdown).toContain(
      "**Bold** [runbook](https://runbooks.example/db)",
    );
  });

  test("labels are named in name order, read as root within the project", async () => {
    const markdown: string = await markdownOf(
      { labels: [PAYMENTS, EU_WEST, label(CHECKOUT)] },
      { labels: true },
    );

    expect(markdown).toBe(
      "\n\n**🏷️ Labels**:\n\n- checkout\n- eu-west\n- payments\n",
    );

    expect(labelReads).toHaveBeenCalledTimes(1);

    const read: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    } = labelReads.mock.calls[0]![0] as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: Dictionary<unknown>;
    };

    expect(read.query["projectId"]).toEqual(PROJECT_ID);
    expect(read.select).toEqual({ name: true });
    expect(read.props).toEqual({ isRoot: true });
  });

  test("label names are quoted inertly", async () => {
    labelNames[EU_WEST] = "[eu](https://evil.example) <img>";

    expect(await markdownOf({ labels: [EU_WEST] }, { labels: true })).toContain(
      "- \\[eu\\](https://evil.example) \\<img>",
    );
  });

  test("every label taken off says so, without reading any", async () => {
    for (const cleared of [[], null]) {
      expect(await markdownOf({ labels: cleared }, { labels: true })).toBe(
        "\n\n**🏷️ Labels**: \nAll labels removed.\n",
      );
    }

    expect(labelReads).not.toHaveBeenCalled();
  });

  test("labels none of which can be read any more make no line", async () => {
    labelNames = {};

    expect(await markdownOf({ labels: [EU_WEST] }, { labels: true })).toBe("");
  });

  test("the reminders switch has no line of its own", async () => {
    expect(
      await markdownOf({ enableReminders: false }, { enableReminders: true }),
    ).toBe("");
  });
});

/*
 * The same comparison, for the other records whose "updated" feed item
 * follows real changes: a scheduled maintenance event (its title and its
 * Markdown description, its Send reminders switch) and a monitor (its name
 * and its plain-text description, no reminders). Each is a kind
 * (EventFieldKind); incidents and alerts are the kind when none is named.
 */
describe("EventFieldChange kinds", () => {
  test("a monitor compares its name and description, and has no reminders switch", () => {
    expect(
      EventFieldChange.getFieldsWritten(
        {
          name: "API",
          description: "x",
          title: "x",
          rootCause: "x",
          remediationNotes: "x",
          labels: [],
          enableReminders: false,
        },
        MONITOR_FIELDS,
      ),
    ).toEqual({
      textColumns: ["name", "description"],
      labels: true,
      enableReminders: false,
    });
  });

  test("a scheduled maintenance event compares its title and description, and its reminders switch", () => {
    expect(
      EventFieldChange.getFieldsWritten(
        {
          title: "x",
          name: "x",
          rootCause: "x",
          description: "x",
          remediationNotes: "x",
          enableReminders: true,
        },
        SCHEDULED_MAINTENANCE_FIELDS,
      ),
    ).toEqual({
      textColumns: ["title", "description"],
      labels: false,
      enableReminders: true,
    });
  });

  test("incidents and alerts are the kind when none is named", () => {
    expect(
      EventFieldChange.getFieldsWritten({ name: "x", title: "x" }),
    ).toEqual({ ...NOTHING, textColumns: ["title"] });
    expect(EventFieldChange.textColumns).toEqual(
      INCIDENT_OR_ALERT_FIELDS.textColumns,
    );
    expect(
      EventFieldChange.getChanges({
        written: { name: "Renamed" },
        valuesBeforeUpdate: undefined,
      }),
    ).toEqual(NOTHING);
  });

  test("every kind's text columns are ones the feed lists, and its Markdown ones among them", () => {
    for (const kind of [
      INCIDENT_OR_ALERT_FIELDS,
      SCHEDULED_MAINTENANCE_FIELDS,
      MONITOR_FIELDS,
    ]) {
      for (const column of kind.textColumns) {
        expect(EventFieldChange.feedOrder).toContain(column);
        expect(EventFieldChange.emptyTextLines[column]).toBeTruthy();
      }

      for (const column of kind.markdownColumns) {
        expect(kind.textColumns).toContain(column);
      }
    }
  });

  test("a monitor written back as it is changes nothing", () => {
    expect(
      EventFieldChange.getChanges({
        written: {
          name: " API ",
          description: "Checks the API.\r\nEvery minute.\n",
          labels: [PAYMENTS, CHECKOUT.toUpperCase()],
          enableReminders: false,
        },
        valuesBeforeUpdate: {
          name: "API",
          description: "Checks the API.\nEvery minute.",
          labelIds: [CHECKOUT, PAYMENTS],
        },
        kind: MONITOR_FIELDS,
      }),
    ).toEqual(NOTHING);
  });

  test("a monitor renamed changes its name, and nothing else", () => {
    expect(
      EventFieldChange.getChanges({
        written: { name: "Public API", description: "Checks the API." },
        valuesBeforeUpdate: { name: "API", description: "Checks the API." },
        kind: MONITOR_FIELDS,
      }),
    ).toEqual({ ...NOTHING, textColumns: ["name"] });
  });

  test("a monitor the read did not see: every column of its kind the update writes counts as changed", () => {
    expect(
      EventFieldChange.getChanges({
        written: {
          name: "API",
          description: "x",
          labels: [],
          title: "x",
          enableReminders: true,
        },
        valuesBeforeUpdate: undefined,
        kind: MONITOR_FIELDS,
      }),
    ).toEqual({
      textColumns: ["name", "description"],
      labels: true,
      enableReminders: false,
    });
  });

  test("the read before the write asks a monitor for its own columns only", () => {
    expect(
      EventFieldChange.getSelect(
        EventFieldChange.getFieldsWritten(
          { name: "x", description: "x", enableReminders: true },
          MONITOR_FIELDS,
        ),
      ),
    ).toEqual({ name: true, description: true });
  });
});

describe("EventFieldChange.getFeedMarkdown for a monitor", () => {
  function monitorMarkdown(
    written: Dictionary<unknown>,
    textColumns: Array<"name" | "description">,
  ): Promise<string> {
    return EventFieldChange.getFeedMarkdown({
      written: written,
      changes: { ...NOTHING, textColumns: textColumns },
      projectId: PROJECT_ID,
      recordName: "Monitor",
      kind: MONITOR_FIELDS,
    });
  }

  test("the name is one line, quoted inertly", async () => {
    expect(
      await monitorMarkdown({ name: "API [prod](https://evil.example)\n<b>" }, [
        "name",
      ]),
    ).toBe("\n\n**Name**: \nAPI \\[prod\\](https://evil.example) \\<b>\n");
  });

  test("the description is plain text: quoted inertly, its lines kept, named after the monitor", async () => {
    expect(
      await monitorMarkdown(
        {
          description:
            "Checks the API.\r\n![pixel](https://tracker.example/p.png)",
        },
        ["description"],
      ),
    ).toBe(
      "\n\n**Monitor Description**: \nChecks the API.\n!\\[pixel\\](https://tracker.example/p.png)\n",
    );
  });

  test("the name comes before the description, whatever order they are written in", async () => {
    const markdown: string = await monitorMarkdown(
      { description: "Checks the API.", name: "API" },
      ["description", "name"],
    );

    expect(markdown.indexOf("**Name**")).toBeLessThan(
      markdown.indexOf("**Monitor Description**"),
    );
  });

  test("a name or a description emptied says so", async () => {
    expect(await monitorMarkdown({ name: "  " }, ["name"])).toBe(
      "\n\n**Name**: \nNo name provided.\n",
    );
    expect(await monitorMarkdown({ description: null }, ["description"])).toBe(
      "\n\n**Monitor Description**: \nNo description provided.\n",
    );
  });

  test("a scheduled maintenance description is Markdown, shown as written", async () => {
    expect(
      await EventFieldChange.getFeedMarkdown({
        written: { description: "**Database** [runbook](https://r.example)" },
        changes: { ...NOTHING, textColumns: ["description"] },
        projectId: PROJECT_ID,
        recordName: "Scheduled Maintenance",
        kind: SCHEDULED_MAINTENANCE_FIELDS,
      }),
    ).toBe(
      "\n\n**Scheduled Maintenance Description**: \n**Database** [runbook](https://r.example)\n",
    );
  });
});

describe("EventFieldChange.toInstant and isInstantChanged", () => {
  const NOON_UTC: number = Date.UTC(2026, 9, 7, 12, 0, 0);

  test.each([
    ["a Date", new Date(NOON_UTC), NOON_UTC],
    ["an ISO string in UTC", "2026-10-07T12:00:00.000Z", NOON_UTC],
    ["an ISO string without milliseconds", "2026-10-07T12:00:00Z", NOON_UTC],
    [
      "an ISO string in another time zone",
      "2026-10-07T14:00:00+02:00",
      NOON_UTC,
    ],
    ["an ISO string with spaces around it", " 2026-10-07T12:00:00Z ", NOON_UTC],
    ["a number of milliseconds", NOON_UTC, NOON_UTC],
    ["null", null, null],
    ["undefined", undefined, null],
    ["an empty string", "", null],
    ["a string that names no time", "next Tuesday-ish", null],
    ["an invalid Date", new Date("x"), null],
    ["NaN", NaN, null],
    ["an object", { value: NOON_UTC }, null],
  ] as Array<[string, unknown, number | null]>)(
    "%s",
    (_label: string, value: unknown, instant: number | null) => {
      expect(EventFieldChange.toInstant(value)).toBe(instant);
    },
  );

  test.each([
    [
      "the same time as a Date and as an ISO string",
      "2026-10-07T12:00:00.000Z",
      new Date(NOON_UTC),
      false,
    ],
    [
      "the same time in another time zone",
      "2026-10-07T14:00:00+02:00",
      NOON_UTC,
      false,
    ],
    ["the same time as milliseconds", NOON_UTC, NOON_UTC, false],
    ["no time over no time", null, null, false],
    ["a minute later", "2026-10-07T12:01:00.000Z", NOON_UTC, true],
    ["a time over none", new Date(NOON_UTC), null, true],
    ["none over a time", null, NOON_UTC, true],
  ] as Array<[string, unknown, unknown, boolean]>)(
    "%s",
    (
      _label: string,
      writtenValue: unknown,
      valueBeforeUpdate: unknown,
      changed: boolean,
    ) => {
      expect(
        EventFieldChange.isInstantChanged({
          writtenValue: writtenValue,
          valueBeforeUpdate: valueBeforeUpdate,
        }),
      ).toBe(changed);
    },
  );

  test("a time left out is not changed; a record the read did not see is", () => {
    expect(
      EventFieldChange.isInstantChanged({
        writtenValue: undefined,
        valueBeforeUpdate: NOON_UTC,
      }),
    ).toBe(false);
    expect(
      EventFieldChange.isInstantChanged({
        writtenValue: new Date(NOON_UTC),
        valueBeforeUpdate: undefined,
      }),
    ).toBe(true);
  });
});
