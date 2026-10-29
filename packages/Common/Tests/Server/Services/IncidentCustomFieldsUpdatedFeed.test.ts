import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../../Server/Services/IncidentCustomFieldService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
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
 * AN INCIDENT'S CUSTOM FIELDS, CHANGED, ARE IN ITS FEED.
 *
 * Customer feedback asked to set an incident's custom fields from Slack -
 * and a change made there must be seen where the incident is followed: its
 * feed, and the incident's own Slack and Microsoft Teams channels the feed
 * posts to. Before, a custom field set from anywhere - the Custom Fields
 * card, the API, now Slack and Teams - added nothing to the feed.
 *
 * The incident's "updated" feed item now lists each custom field whose value
 * the update really changed, with its new value, or that it was cleared.
 * These run the real onBeforeUpdate - which reads what the incident held,
 * only when the update writes its custom fields - and hand what it carries
 * forward to the real onUpdateSuccess; only the database and the side
 * effects' own services are stubbed (as UpdatedFeedRealChanges.test.ts).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e",
);
const USER_ID: ObjectID = new ObjectID("6e7f8091-a2b3-4c4d-9e5f-6a7b8c9d0e1f");
const INCIDENT_ID: string = "7f8091a2-b3c4-4d5e-8f6a-7b8c9d0e1f2a";

const INCIDENT_LINK: string = "https://oneuptime.test/i";
/*
 * A person's update: a sentence written to follow their name, which the
 * feed and the incident's channels put in front of it ("Valeria updated
 * Incident INC-42."). OneUptime's own reads "Incident INC-42 was updated."
 */
const UPDATED_LINE: string = `✏️ Updated [Incident INC-42](${INCIDENT_LINK}).`;
const UPDATED_BY_NOBODY_LINE: string = `**[Incident INC-42](${INCIDENT_LINK}) was updated.**`;

const STORED_TITLE: string = "Checkout errors in EU";

// The project's incident custom fields.
const DEFINITIONS: Array<{
  name: string;
  type: CustomFieldType;
  options?: string;
}> = [
  {
    name: "Customer Impact",
    type: CustomFieldType.Dropdown,
    options: "High\nMedium\nLow",
  },
  { name: "Ticket", type: CustomFieldType.Text },
  { name: "Affected Users", type: CustomFieldType.Number },
  { name: "Public", type: CustomFieldType.Boolean },
  {
    name: "Regions",
    type: CustomFieldType.MultiSelectDropdown,
    options: "eu-west\nus-east\nap-south",
  },
  { name: "Due", type: CustomFieldType.Date },
  // Holds nothing yet.
  { name: "Started", type: CustomFieldType.DateTime },
];

/*
 * Each field's place on the Custom Fields card (its sort order), by name;
 * a field with none comes after those with one, in the order they are read.
 */
let sortOrders: Record<string, number> = {};

// What the incident holds, as the database stores it.
const STORED_CUSTOM_FIELDS: JSONObject = {
  "Customer Impact": "Medium",
  Ticket: "OPS-118",
  "Affected Users": 1200,
  Public: false,
  Regions: ["eu-west", "us-east"],
  Due: "2026-10-20",
};

// Someone who may edit incidents, as the API, Slack or Teams act for them.
function member(): DatabaseCommonInteractionProps {
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

type OnBeforeUpdate = (updateBy: UpdateBy<never>) => Promise<OnUpdate<never>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

const hooks: {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
} = IncidentService as unknown as {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
};

// What the incident holds; null for a row the read does not see.
let stored: { customFields: JSONObject | null; title: string } | null;

let reads: MockFunction;
let feed: MockFunction;
let definitionReads: MockFunction;

beforeEach(() => {
  stored = {
    customFields: { ...STORED_CUSTOM_FIELDS },
    title: STORED_TITLE,
  };
  sortOrders = {};

  stubRowsCallerMayWriteLikeFindBy(
    IncidentService,
    jest.spyOn(IncidentService, "findBy"),
  );
  stubProjectDirectory({});

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  // The incident as findBy answers it: the columns asked for, no others.
  reads = getJestMockFunction();
  reads.mockImplementation(
    async (findBy: {
      select: Dictionary<unknown>;
    }): Promise<Array<Incident>> => {
      if (!stored) {
        return [];
      }

      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID;
      incident.projectId = PROJECT_ID;

      if (findBy.select["customFields"]) {
        incident.customFields = stored.customFields as never;
      }

      if (findBy.select["title"]) {
        incident.title = stored.title;
      }

      return [incident];
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
    .mockResolvedValue(URL.fromString(INCIDENT_LINK) as never);
  jest
    .spyOn(IncidentService, "refreshReminderSchedule")
    .mockResolvedValue(undefined as never);

  feed = getJestMockFunction();
  feed.mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(feed as never);

  definitionReads = getJestMockFunction();
  definitionReads.mockImplementation(
    async (): Promise<Array<IncidentCustomField>> => {
      return DEFINITIONS.map(
        (definition: {
          name: string;
          type: CustomFieldType;
          options?: string;
        }): IncidentCustomField => {
          const row: IncidentCustomField = new IncidentCustomField();
          row.name = definition.name;
          row.customFieldType = definition.type;

          if (definition.options) {
            row.dropdownOptions = definition.options;
          }

          if (sortOrders[definition.name] !== undefined) {
            row.sortOrder = sortOrders[definition.name]!;
          }

          return row;
        },
      );
    },
  );
  jest
    .spyOn(IncidentCustomFieldService, "findBy")
    .mockImplementation(definitionReads as never);

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
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function runUpdate(
  data: Dictionary<unknown>,
  props: DatabaseCommonInteractionProps = member(),
): Promise<void> {
  const onUpdate: OnUpdate<never> = await hooks.onBeforeUpdate({
    query: { _id: INCIDENT_ID } as never,
    data: data as never,
    props: props,
    limit: 1,
    skip: 0,
  });

  await hooks.onUpdateSuccess(onUpdate, [new ObjectID(INCIDENT_ID)]);
}

// The one feed item the update wrote: its Markdown.
function onlyFeedItem(): string {
  expect(feed).toHaveBeenCalledTimes(1);
  return (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

// The Custom Fields card's save: every field, with what changed.
function customFieldsCardSave(changes: JSONObject): Dictionary<unknown> {
  return {
    customFields: { ...STORED_CUSTOM_FIELDS, ...changes },
  };
}

describe("an update that changes an incident's custom fields", () => {
  test("one field changed - from Slack, Teams or the Custom Fields card, which all write the whole bag - is the item's one line", async () => {
    await runUpdate(customFieldsCardSave({ "Customer Impact": "High" }));

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Customer Impact**: High\n`,
    );
  });

  test("the item is the incident's own 'updated' item, credited to whoever changed it", async () => {
    await runUpdate(customFieldsCardSave({ Ticket: "OPS-200" }));

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feed.mock.calls[0]![0]).toEqual(
      expect.objectContaining({
        incidentId: new ObjectID(INCIDENT_ID),
        projectId: PROJECT_ID,
        userId: USER_ID,
      }),
    );
  });

  test("several fields: a line each, the values as a person reads them", async () => {
    await runUpdate(
      customFieldsCardSave({
        Public: true,
        Regions: ["ap-south"],
        "Affected Users": 2500,
        Due: "2026-11-01",
      }),
    );

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Affected Users**: 2500\n- **Public**: Yes\n- **Regions**: ap-south\n- **Due**: 2026-11-01\n`,
    );
  });

  test("a field emptied, or left out of the bag, reads cleared", async () => {
    const withoutDue: JSONObject = { ...STORED_CUSTOM_FIELDS };
    delete withoutDue["Due"];

    await runUpdate({ customFields: { ...withoutDue, Ticket: "" } });

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Ticket**: cleared\n- **Due**: cleared\n`,
    );
  });

  test("the fields in the Custom Fields card's order, however the bag lists them - the database keeps a bag's keys in an order of its own", async () => {
    sortOrders = { Due: 1, Ticket: 2, "Customer Impact": 3 };

    const written: JSONObject = Object.fromEntries(
      Object.entries({
        ...STORED_CUSTOM_FIELDS,
        "Customer Impact": "High",
        Ticket: "OPS-200",
        Public: true,
        Due: "2026-11-01",
      }).reverse(),
    ) as JSONObject;

    await runUpdate({ customFields: written });

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Due**: 2026-11-01\n- **Ticket**: OPS-200\n- **Customer Impact**: High\n- **Public**: Yes\n`,
    );
    // Read with their place on the card.
    expect(
      (definitionReads.mock.calls[0]![0] as { select: Dictionary<unknown> })
        .select["sortOrder"],
    ).toBe(true);
  });

  test("a date and time reads as the feed's other times do, its zone named - not as the ISO text it is stored as", async () => {
    await runUpdate(
      customFieldsCardSave({ Started: "2026-10-15T09:12:00.000Z" }),
    );

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Started**: ${OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date("2026-10-15T09:12:00.000Z"),
      )}\n`,
    );
    expect(onlyFeedItem()).not.toContain("2026-10-15T09:12");
  });

  test("a value set on an incident that held no custom fields", async () => {
    stored = { customFields: null, title: STORED_TITLE };

    await runUpdate({ customFields: { Ticket: "OPS-7" } });

    expect(onlyFeedItem()).toBe(
      `${UPDATED_LINE}\n\n**📝 Custom Fields**:\n\n- **Ticket**: OPS-7\n`,
    );
  });

  test("with the title changed in the same update: one item, both told", async () => {
    await runUpdate({
      title: "Checkout errors everywhere",
      ...customFieldsCardSave({ "Customer Impact": "High" }),
    });

    const markdown: string = onlyFeedItem();

    expect(markdown).toContain("Checkout errors everywhere");
    expect(markdown).toContain(
      "\n\n**📝 Custom Fields**:\n\n- **Customer Impact**: High\n",
    );
  });

  test("a workflow writing as OneUptime (root) is told as well", async () => {
    await runUpdate(customFieldsCardSave({ Ticket: "OPS-300" }), {
      isRoot: true,
      tenantId: PROJECT_ID,
    });

    expect(onlyFeedItem()).toContain("- **Ticket**: OPS-300\n");
    // Nobody made it by hand: it says the incident was updated.
    expect(onlyFeedItem().startsWith(UPDATED_BY_NOBODY_LINE)).toBe(true);
  });
});

describe("an update that changes none of them adds nothing about them", () => {
  test("the Custom Fields card saved unchanged: no feed item", async () => {
    await runUpdate(customFieldsCardSave({}));

    expect(feed).not.toHaveBeenCalled();
  });

  test("the same values written another way: no feed item", async () => {
    await runUpdate(
      customFieldsCardSave({
        "Affected Users": "1200",
        Public: "false",
        Regions: ["us-east", "eu-west"],
        Due: "2026-10-20T00:00:00.000Z",
      }),
    );

    expect(feed).not.toHaveBeenCalled();
  });

  test("a value refused by its field's type is never written, so never told", async () => {
    await expect(
      runUpdate(customFieldsCardSave({ "Affected Users": "lots" })),
    ).rejects.toThrow(BadDataException);

    expect(feed).not.toHaveBeenCalled();
  });

  test("an update that writes no custom fields does not read them, and tells only what it changed", async () => {
    await runUpdate({ title: "Checkout errors everywhere" });

    const markdown: string = onlyFeedItem();
    expect(markdown).not.toContain("Custom Fields");

    for (const call of reads.mock.calls) {
      expect(
        (call[0] as { select: Dictionary<unknown> }).select["customFields"],
      ).toBeUndefined();
    }
    expect(definitionReads).not.toHaveBeenCalled();
  });

  test("an incident whose bag the read before the write did not see: nothing is said that may not be so", async () => {
    stored = null;

    await runUpdate(customFieldsCardSave({ Ticket: "OPS-200" }));

    expect(feed).not.toHaveBeenCalled();
  });
});
