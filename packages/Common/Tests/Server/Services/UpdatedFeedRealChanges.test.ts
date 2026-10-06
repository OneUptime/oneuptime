import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import LabelService from "../../../Server/Services/LabelService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
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
 * An incident's or an alert's "updated" feed item records what an update
 * changed, and a change of its labels - or of its Send reminders switch -
 * matches its reminder rule again, which starts the reminder interval over.
 *
 * Updates often write back what a record holds. The Incident Details card
 * sends the title, the severity and the labels with every save, the
 * Description, Root Cause and Remediation pages send their one field, and an
 * API client, a workflow or Terraform may write the whole record. The feed
 * lines for the title, the description, the root cause, the remediation
 * notes and the labels used to follow whether the update carried the field,
 * not whether it changed: every such save added an "updated" item repeating
 * what it carried, posted to the record's Slack and Microsoft Teams channels
 * too, and any labels write restarted the reminder interval, so a record
 * edited often kept putting its reminders off. (The severity follows real
 * changes since #4422.)
 *
 * Now each service reads what the record holds before the write - the one
 * stored read of its onBeforeUpdate, and only the columns the update writes
 * - and each line, and the reminder refresh, follows a real change. These
 * tests run the real onBeforeUpdate and hand what it carries forward to the
 * real onUpdateSuccess, for both kinds; only the database and the side
 * effects' own services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-feed-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-feed-4aaa-8bbb-000000000002");
const RECORD_ID: string = "0193c0de-feed-4aaa-8bbb-0000000000a1";
const SECOND_RECORD_ID: string = "0193c0de-feed-4aaa-8bbb-0000000000a2";

const MINOR: string = "0193c0de-feed-4aaa-8bbb-0000000000b1";
const CRITICAL: string = "0193c0de-feed-4aaa-8bbb-0000000000b2";

const CHECKOUT: string = "0193c0de-feed-4aaa-8bbb-0000000000c1";
const PAYMENTS: string = "0193c0de-feed-4aaa-8bbb-0000000000c2";
const EU_WEST: string = "0193c0de-feed-4aaa-8bbb-0000000000c3";

const LABEL_NAMES: Record<string, string> = {
  [CHECKOUT]: "checkout",
  [PAYMENTS]: "payments",
  [EU_WEST]: "eu-west",
};

const SEVERITY_NAMES: Record<string, string> = {
  [MINOR]: "Minor",
  [CRITICAL]: "Critical",
};

const STORED_TITLE: string = "Checkout errors in EU";
const STORED_DESCRIPTION: string =
  "Customers in the EU see errors at checkout.\n\nIt started after the 14:02 deploy.";
const STORED_ROOT_CAUSE: string = "A bad config push to the payments gateway.";
const STORED_REMEDIATION: string = "Rolled the gateway config back.";

// A record as the database holds it.
interface StoredRecord {
  id: string;
  title: string | null;
  description: string | null;
  rootCause: string | null;
  remediationNotes: string | null;
  labelIds: Array<string>;
  enableReminders: boolean | null;
  severityId: string | null;
}

function storedRecord(overrides: Partial<StoredRecord> = {}): StoredRecord {
  return {
    id: RECORD_ID,
    title: STORED_TITLE,
    description: STORED_DESCRIPTION,
    rootCause: STORED_ROOT_CAUSE,
    remediationNotes: STORED_REMEDIATION,
    labelIds: [CHECKOUT, PAYMENTS],
    enableReminders: true,
    severityId: MINOR,
    ...overrides,
  };
}

type OnBeforeUpdate = (updateBy: UpdateBy<never>) => Promise<OnUpdate<never>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

interface Hooks {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
}

// What a kind's update sets off, as the stubs record it.
interface Effects {
  reads: MockFunction;
  feed: MockFunction;
  refreshReminders: MockFunction;
  labelReads: MockFunction;
}

interface Kind {
  name: string;
  hooks: Hooks;
  severityIdColumn: string;
  severityRelation: string;
  descriptionHeading: string;
  severityHeading: string;
  // Installs the kind's stubs over the records stored at the time of a read.
  stub: (stored: () => Array<StoredRecord>) => Omit<Effects, "labelReads">;
}

// Someone who may edit incidents and alerts, as the API sees them.
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

function label(id: string): Label {
  const row: Label = new Label();
  row._id = id;
  return row;
}

// The ids a QueryHelper.any() asks for: an IN over its Raw's parameters.
function idsAskedFor(value: unknown): Array<string> {
  const operator: { objectLiteralParameters?: Dictionary<unknown> } =
    (value || {}) as { objectLiteralParameters?: Dictionary<unknown> };

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

/*
 * A stored record as findBy answers it: the columns the read asks for, and
 * no others. A NULL column comes back as null.
 */
function rowOf<T extends Incident | Alert>(data: {
  row: T;
  record: StoredRecord;
  select: Dictionary<unknown>;
  severityIdColumn: string;
}): T {
  const row: T = data.row;
  const columns: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  row._id = data.record.id;
  row.projectId = PROJECT_ID;

  for (const column of Object.keys(data.select)) {
    if (column === "labels") {
      row.labels = data.record.labelIds.map(label);
      continue;
    }

    if (column === data.severityIdColumn) {
      columns[column] = data.record.severityId
        ? new ObjectID(data.record.severityId)
        : null;
      continue;
    }

    if (
      [
        "title",
        "description",
        "rootCause",
        "remediationNotes",
        "enableReminders",
      ].includes(column)
    ) {
      columns[column] = data.record[column as keyof StoredRecord];
    }
  }

  return row;
}

// The stored records a read matches: by its _id, or every one.
function matching(
  records: Array<StoredRecord>,
  query: Dictionary<unknown>,
): Array<StoredRecord> {
  const id: unknown = query["_id"];

  if (typeof id !== "string" && !(id instanceof ObjectID)) {
    return records;
  }

  return records.filter((record: StoredRecord): boolean => {
    return record.id === id.toString().toLowerCase();
  });
}

function stubIncident(
  stored: () => Array<StoredRecord>,
): Omit<Effects, "labelReads"> {
  const reads: MockFunction = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Incident>> => {
      return matching(stored(), findBy.query).map(
        (record: StoredRecord): Incident => {
          return rowOf({
            row: new Incident(),
            record: record,
            select: findBy.select,
            severityIdColumn: "incidentSeverityId",
          });
        },
      );
    },
  );
  jest.spyOn(IncidentService, "findBy").mockImplementation(reads as never);

  jest.spyOn(IncidentService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Incident> => {
    const incident: Incident = new Incident();
    incident._id = data.id.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    return incident;
  }) as never);

  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);

  const refreshReminders: MockFunction = getJestMockFunction();
  refreshReminders.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentService, "refreshReminderSchedule")
    .mockImplementation(refreshReminders as never);

  const feed: MockFunction = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(feed as never);

  jest.spyOn(IncidentSeverityService, "findOneBy").mockImplementation((async (
    findOneBy: { query: { _id: unknown } },
  ): Promise<IncidentSeverity> => {
    const id: string = String(findOneBy.query._id).toLowerCase();
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = id;
    severity.name = SEVERITY_NAMES[id] || "Unknown";
    return severity;
  }) as never);
  jest
    .spyOn(IncidentSlaService, "recalculateDeadlines")
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

  return { reads, feed, refreshReminders };
}

function stubAlert(
  stored: () => Array<StoredRecord>,
): Omit<Effects, "labelReads"> {
  const reads: MockFunction = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    }): Promise<Array<Alert>> => {
      return matching(stored(), findBy.query).map(
        (record: StoredRecord): Alert => {
          return rowOf({
            row: new Alert(),
            record: record,
            select: findBy.select,
            severityIdColumn: "alertSeverityId",
          });
        },
      );
    },
  );
  jest.spyOn(AlertService, "findBy").mockImplementation(reads as never);

  jest.spyOn(AlertService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Alert> => {
    const alert: Alert = new Alert();
    alert._id = data.id.toString();
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 7;
    alert.alertNumberWithPrefix = "ALT-7";
    return alert;
  }) as never);

  jest
    .spyOn(AlertService, "getAlertLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.test/a") as never);

  const refreshReminders: MockFunction = getJestMockFunction();
  refreshReminders.mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertService, "refreshReminderSchedule")
    .mockImplementation(refreshReminders as never);

  const feed: MockFunction = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockImplementation(feed as never);

  jest.spyOn(AlertSeverityService, "findOneBy").mockImplementation((async (
    findOneBy: { query: { _id: unknown } },
  ): Promise<AlertSeverity> => {
    const id: string = String(findOneBy.query._id).toLowerCase();
    const severity: AlertSeverity = new AlertSeverity();
    severity._id = id;
    severity.name = SEVERITY_NAMES[id] || "Unknown";
    return severity;
  }) as never);

  return { reads, feed, refreshReminders };
}

const KINDS: Array<Kind> = [
  {
    name: "incident",
    hooks: IncidentService as unknown as Hooks,
    severityIdColumn: "incidentSeverityId",
    severityRelation: "incidentSeverity",
    descriptionHeading: "**Incident Description**",
    severityHeading: "**⚠️ Incident Severity**",
    stub: stubIncident,
  },
  {
    name: "alert",
    hooks: AlertService as unknown as Hooks,
    severityIdColumn: "alertSeverityId",
    severityRelation: "alertSeverity",
    descriptionHeading: "**Alert Description**",
    severityHeading: "**⚠️ Alert Severity**",
    stub: stubAlert,
  },
];

const TITLE_HEADING: string = "**Title**";
const ROOT_CAUSE_HEADING: string = "**📄 Root Cause**";
const REMEDIATION_HEADING: string = "**🎯 Remediation Notes**";
const LABELS_HEADING: string = "**🏷️ Labels**";

let storedRecords: Array<StoredRecord> = [];

beforeEach(() => {
  storedRecords = [storedRecord()];

  // Every label and severity named here is the project's own.
  stubProjectDirectory({});

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("$name updates", (kind: Kind) => {
  let effects: Effects;

  beforeEach(() => {
    const labelReads: MockFunction = getJestMockFunction();
    labelReads.mockImplementation(
      async (findBy: { query: Dictionary<unknown> }): Promise<Array<Label>> => {
        return idsAskedFor(findBy.query["_id"])
          .filter((id: string): boolean => {
            return Boolean(LABEL_NAMES[id]);
          })
          .map((id: string): Label => {
            const row: Label = label(id);
            row.name = LABEL_NAMES[id]!;
            return row;
          });
      },
    );
    jest.spyOn(LabelService, "findBy").mockImplementation(labelReads as never);

    effects = {
      ...kind.stub(() => {
        return storedRecords;
      }),
      labelReads: labelReads,
    };
  });

  async function runBeforeUpdate(
    data: Dictionary<unknown>,
    query: Dictionary<unknown> = { _id: RECORD_ID },
  ): Promise<OnUpdate<never>> {
    return await kind.hooks.onBeforeUpdate({
      query: query as never,
      data: data as never,
      props: editor(),
      limit: 1,
      skip: 0,
    });
  }

  async function runUpdate(
    data: Dictionary<unknown>,
    options: {
      query?: Dictionary<unknown>;
      updatedIds?: Array<string>;
    } = {},
  ): Promise<void> {
    const onUpdate: OnUpdate<never> = await runBeforeUpdate(
      data,
      options.query,
    );

    await kind.hooks.onUpdateSuccess(
      onUpdate,
      (options.updatedIds || [RECORD_ID]).map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    );
  }

  function feedMarkdown(): Array<string> {
    return effects.feed.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    });
  }

  // The one feed item the update wrote.
  function onlyFeedItem(): string {
    expect(effects.feed).toHaveBeenCalledTimes(1);
    return feedMarkdown()[0]!;
  }

  // What the Incident Details / Alert Details card sends with every save.
  function detailsCardSave(
    overrides: Dictionary<unknown> = {},
  ): Dictionary<unknown> {
    return {
      title: STORED_TITLE,
      [kind.severityRelation]: { _id: MINOR },
      labels: [label(CHECKOUT), label(PAYMENTS)],
      ...overrides,
    };
  }

  // A client that writes the whole record back: the API, a workflow, Terraform.
  function wholeRecordWriteBack(
    overrides: Dictionary<unknown> = {},
  ): Dictionary<unknown> {
    return {
      title: STORED_TITLE,
      description: STORED_DESCRIPTION,
      rootCause: STORED_ROOT_CAUSE,
      remediationNotes: STORED_REMEDIATION,
      labels: [PAYMENTS, CHECKOUT],
      enableReminders: true,
      [kind.severityIdColumn]: new ObjectID(MINOR),
      ...overrides,
    };
  }

  function expectNothing(): void {
    expect(effects.feed).not.toHaveBeenCalled();
    expect(effects.refreshReminders).not.toHaveBeenCalled();
  }

  describe("an update that writes back what the record holds adds nothing", () => {
    test.each([
      ["the Details card saved unchanged", (): Dictionary<unknown> => {
        return detailsCardSave();
      }],
      ["the Description page saved unchanged", (): Dictionary<unknown> => {
        return { description: STORED_DESCRIPTION };
      }],
      ["the Root Cause page saved unchanged", (): Dictionary<unknown> => {
        return { rootCause: STORED_ROOT_CAUSE };
      }],
      ["the Remediation page saved unchanged", (): Dictionary<unknown> => {
        return { remediationNotes: STORED_REMEDIATION };
      }],
      [
        "the whole record written back, as an API client, a workflow or Terraform may",
        (): Dictionary<unknown> => {
          return wholeRecordWriteBack();
        },
      ],
      ["the Send reminders switch written as it stands", (): Dictionary<unknown> => {
        return { enableReminders: true };
      }],
    ] as Array<[string, () => Dictionary<unknown>]>)(
      "%s: no feed item, and the reminder interval runs on",
      async (_label: string, payload: () => Dictionary<unknown>) => {
        await runUpdate(payload());

        expectNothing();
      },
    );

    test("the labels sent in another order, repeated, in another case or as bare ids are the labels it has", async () => {
      for (const labels of [
        [label(PAYMENTS), label(CHECKOUT)],
        [label(CHECKOUT), label(PAYMENTS), label(CHECKOUT)],
        [label(CHECKOUT.toUpperCase()), label(PAYMENTS)],
        [CHECKOUT, PAYMENTS],
        [new ObjectID(PAYMENTS), new ObjectID(CHECKOUT)],
        [{ _id: CHECKOUT }, { _id: PAYMENTS }],
      ]) {
        await runUpdate({ labels: labels });
      }

      expectNothing();
    });

    test("no labels written over none, as [] or as null, is no change", async () => {
      storedRecords = [storedRecord({ labelIds: [] })];

      await runUpdate({ labels: [] });
      await runUpdate({ labels: null });

      expectNothing();
    });

    test("text that reads the same is the same: line endings and the whitespace around it", async () => {
      await runUpdate({
        description: STORED_DESCRIPTION.replace(/\n/g, "\r\n"),
      });
      await runUpdate({ rootCause: `  ${STORED_ROOT_CAUSE}\n` });
      await runUpdate({ remediationNotes: `${STORED_REMEDIATION}\n\n` });
      await runUpdate({ title: ` ${STORED_TITLE} ` });

      expectNothing();
    });

    test("an empty text written over none is no change", async () => {
      storedRecords = [
        storedRecord({
          description: null,
          rootCause: null,
          remediationNotes: null,
        }),
      ];

      await runUpdate({ description: "", rootCause: "  ", remediationNotes: null });

      expectNothing();
    });

    test("Send reminders written on over a record that never set it (on by default) is no change", async () => {
      storedRecords = [storedRecord({ enableReminders: null })];

      await runUpdate({ enableReminders: true });

      expectNothing();
    });
  });

  describe("each real change adds its own line, once", () => {
    test("a new title, saved from the Details card with the severity and labels unchanged, records the title alone", async () => {
      await runUpdate(detailsCardSave({ title: "Checkout errors everywhere" }));

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(`${TITLE_HEADING}`);
      expect(markdown).toContain("Checkout errors everywhere");
      expect(markdown).not.toContain(LABELS_HEADING);
      expect(markdown).not.toContain(kind.severityHeading);
      expect(markdown).not.toContain(kind.descriptionHeading);
      expect(markdown).not.toContain(ROOT_CAUSE_HEADING);
      expect(markdown).not.toContain(REMEDIATION_HEADING);

      // Neither the labels nor the severity changed: the interval runs on.
      expect(effects.refreshReminders).not.toHaveBeenCalled();
    });

    test("a new description records the description alone", async () => {
      await runUpdate({ description: "Every region sees errors now." });

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(kind.descriptionHeading);
      expect(markdown).toContain("Every region sees errors now.");
      expect(markdown).not.toContain(TITLE_HEADING);
      expect(effects.refreshReminders).not.toHaveBeenCalled();
    });

    test("a new root cause records the root cause alone, written on its own page", async () => {
      await runUpdate({ rootCause: "An expired TLS certificate." });

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(ROOT_CAUSE_HEADING);
      expect(markdown).toContain("An expired TLS certificate.");
      expect(markdown).not.toContain(TITLE_HEADING);
    });

    test("new remediation notes record the notes alone", async () => {
      await runUpdate({ remediationNotes: "Renewed the certificate." });

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(REMEDIATION_HEADING);
      expect(markdown).toContain("Renewed the certificate.");
      expect(markdown).not.toContain(ROOT_CAUSE_HEADING);
    });

    test.each([
      ["rootCause", ROOT_CAUSE_HEADING, "Root cause removed."],
      ["remediationNotes", REMEDIATION_HEADING, "Remediation notes removed."],
      ["description", "Description**", "No description provided."],
    ] as Array<[string, string, string]>)(
      "%s cleared is recorded as removed",
      async (column: string, heading: string, removed: string) => {
        for (const cleared of ["", null]) {
          storedRecords = [storedRecord()];
          effects.feed.mockClear();

          await runUpdate({ [column]: cleared });

          const markdown: string = onlyFeedItem();

          expect(markdown).toContain(heading);
          expect(markdown).toContain(removed);
        }
      },
    );

    test("a label added records the labels the record now has, and matches the reminder rule again", async () => {
      await runUpdate(
        detailsCardSave({
          labels: [label(CHECKOUT), label(PAYMENTS), label(EU_WEST)],
        }),
      );

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(LABELS_HEADING);
      expect(markdown).toContain("- checkout");
      expect(markdown).toContain("- payments");
      expect(markdown).toContain("- eu-west");
      expect(markdown).not.toContain(TITLE_HEADING);

      expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
    });

    test("a label taken off is a change", async () => {
      await runUpdate({ labels: [label(CHECKOUT)] });

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(LABELS_HEADING);
      expect(markdown).toContain("- checkout");
      expect(markdown).not.toContain("- payments");
      expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
    });

    test("every label taken off is recorded as such, as [] or as null", async () => {
      for (const cleared of [[], null]) {
        effects.feed.mockClear();
        effects.refreshReminders.mockClear();

        await runUpdate({ labels: cleared });

        const markdown: string = onlyFeedItem();

        expect(markdown).toContain(LABELS_HEADING);
        expect(markdown).toContain("All labels removed.");
        expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
      }
    });

    test("labels given to a record that had none", async () => {
      storedRecords = [storedRecord({ labelIds: [] })];

      await runUpdate({ labels: [EU_WEST] });

      expect(onlyFeedItem()).toContain("- eu-west");
      expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
    });

    test.each([
      ["off", true, false],
      ["on", false, true],
    ] as Array<[string, boolean, boolean]>)(
      "Send reminders switched %s matches the reminder rule again, and adds no feed item",
      async (_label: string, stored: boolean, written: boolean) => {
        storedRecords = [storedRecord({ enableReminders: stored })];

        await runUpdate({ enableReminders: written });

        expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
        expect(effects.feed).not.toHaveBeenCalled();
      },
    );

    test("a whole-record write-back that changes one field records that field alone", async () => {
      await runUpdate(
        wholeRecordWriteBack({ remediationNotes: "Paged the payments team." }),
      );

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain(REMEDIATION_HEADING);
      expect(markdown).toContain("Paged the payments team.");
      for (const heading of [
        TITLE_HEADING,
        kind.descriptionHeading,
        ROOT_CAUSE_HEADING,
        LABELS_HEADING,
        kind.severityHeading,
      ]) {
        expect(markdown).not.toContain(heading);
      }
      expect(effects.refreshReminders).not.toHaveBeenCalled();
    });

    test("several changes in one update make one feed item, with one line each, and one reminder refresh", async () => {
      await runUpdate(
        detailsCardSave({
          title: "Payments down",
          [kind.severityRelation]: { _id: CRITICAL },
          labels: [label(EU_WEST)],
        }),
      );

      const markdown: string = onlyFeedItem();

      expect(markdown).toContain("Payments down");
      expect(markdown).toContain("- eu-west");
      expect(markdown).toContain(kind.severityHeading);
      expect(markdown).toContain("Critical");

      // Labels and severity both match the reminder rule again: one refresh.
      expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
    });
  });

  describe("the read before the write", () => {
    /*
     * The stored read: as root, pinned to the caller's project, asking for
     * a column the feed or the reminders compare. (The project reference
     * check reads the labels a record holds as well, when an update writes
     * some - unpinned, so a label it already holds may stay: another read,
     * for another question.)
     */
    function comparedReads(): Array<{
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      props: DatabaseCommonInteractionProps;
    }> {
      return effects.reads.mock.calls
        .map((call: Array<unknown>) => {
          return call[0] as {
            query: Dictionary<unknown>;
            select: Dictionary<unknown>;
            props: DatabaseCommonInteractionProps;
          };
        })
        .filter((read: { query: Dictionary<unknown> }): boolean => {
          return read.query["projectId"] !== undefined;
        })
        .filter((read: { select: Dictionary<unknown> }): boolean => {
          return [
            "title",
            "description",
            "rootCause",
            "remediationNotes",
            "labels",
            "enableReminders",
          ].some((column: string): boolean => {
            return read.select[column] !== undefined;
          });
        });
    }

    test("is one read, of the columns the update writes and no others", async () => {
      await runBeforeUpdate(detailsCardSave());

      expect(comparedReads()).toHaveLength(1);
      expect(comparedReads()[0]!.select).toEqual({
        _id: true,
        title: true,
        labels: { _id: true },
        [kind.severityIdColumn]: true,
      });

      effects.reads.mockClear();

      await runBeforeUpdate({ rootCause: "x", enableReminders: false });

      expect(comparedReads()).toHaveLength(1);
      expect(comparedReads()[0]!.select).toEqual({
        _id: true,
        rootCause: true,
        enableReminders: true,
      });
    });

    test("is made as root, within the update's query and the caller's project", async () => {
      await runBeforeUpdate({ description: "x" });

      const read: {
        query: Dictionary<unknown>;
        props: DatabaseCommonInteractionProps;
      } = comparedReads()[0]!;

      expect(read.props).toEqual({ isRoot: true });
      expect(read.query["_id"]).toBe(RECORD_ID);
      expect(read.query["projectId"]).toBe(PROJECT_ID);
    });

    test("is not made for an update that writes none of those columns", async () => {
      await runBeforeUpdate({ [kind.severityIdColumn]: new ObjectID(CRITICAL) });

      expect(comparedReads()).toHaveLength(0);
    });

    test("a record the read did not see counts as changed, so a real change is never missed", async () => {
      await runUpdate(
        { title: STORED_TITLE },
        { updatedIds: [RECORD_ID, SECOND_RECORD_ID] },
      );

      expect(effects.feed).toHaveBeenCalledTimes(1);
      expect(
        String(
          (
            effects.feed.mock.calls[0]![0] as Record<string, unknown>
          )[`${kind.name}Id`],
        ),
      ).toBe(SECOND_RECORD_ID);
    });

    test("one update over two records records the change only where it is one", async () => {
      storedRecords = [
        storedRecord(),
        storedRecord({ id: SECOND_RECORD_ID, labelIds: [EU_WEST] }),
      ];

      await runUpdate(
        { labels: [label(CHECKOUT), label(PAYMENTS)] },
        {
          query: { projectId: PROJECT_ID },
          updatedIds: [RECORD_ID, SECOND_RECORD_ID],
        },
      );

      expect(effects.feed).toHaveBeenCalledTimes(1);
      expect(
        String(
          (
            effects.feed.mock.calls[0]![0] as Record<string, unknown>
          )[`${kind.name}Id`],
        ),
      ).toBe(SECOND_RECORD_ID);
      expect(effects.refreshReminders).toHaveBeenCalledTimes(1);
      expect(
        String(
          (
            effects.refreshReminders.mock.calls[0]![0] as Record<
              string,
              unknown
            >
          )[`${kind.name}Id`],
        ),
      ).toBe(SECOND_RECORD_ID);
    });
  });

  describe("the feed line itself", () => {
    test("names the labels by reading them within the record's project", async () => {
      await runUpdate({ labels: [label(EU_WEST)] });

      expect(effects.labelReads).toHaveBeenCalledTimes(1);

      const read: { query: Dictionary<unknown> } = effects.labelReads.mock
        .calls[0]![0] as { query: Dictionary<unknown> };

      expect(idsAskedFor(read.query["_id"])).toEqual([EU_WEST]);
      expect(read.query["projectId"]).toEqual(PROJECT_ID);
    });

    test("quotes a new title inertly, so it cannot become a link or an image", async () => {
      await runUpdate({
        title: "![pixel](https://tracker.example/p.png) [Reset](https://evil.example)",
      });

      const markdown: string = onlyFeedItem();

      expect(markdown).not.toContain("![pixel](");
      expect(markdown).not.toContain("[Reset](");
      expect(markdown).toContain("\\[Reset\\]");
    });

    test("quotes label names inertly too", async () => {
      LABEL_NAMES[EU_WEST] = "[eu](https://evil.example)";

      try {
        await runUpdate({ labels: [label(EU_WEST)] });

        expect(onlyFeedItem()).toContain("- \\[eu\\](https://evil.example)");
      } finally {
        LABEL_NAMES[EU_WEST] = "eu-west";
      }
    });
  });
});
