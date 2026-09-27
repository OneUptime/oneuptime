import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenancePublicNoteService from "../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import Incident from "../../../Models/DatabaseModels/Incident";
import { IncidentFeedEventType } from "../../../Models/DatabaseModels/IncidentFeed";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import { ScheduledMaintenanceFeedEventType } from "../../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import URL from "../../../Types/API/URL";
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

/*
 * Editing a public note writes a feed item. It used to be logged as a
 * private note - the type the feed filters and icons by, and what a
 * workspace notification rule for private notes reacts to - so an edit to a
 * note every subscriber can read showed up as internal, and one to a note
 * nobody outside the team sees did not.
 */

jest.mock("../../../Server/Utils/InlineImageAccessTokenSync", () => {
  return {
    __esModule: true,
    syncIsPublicForMarkdownImages: jest.fn(async (): Promise<void> => {}),
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const MAINTENANCE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOTE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

type OnUpdateSuccess<TModel> = (
  onUpdate: OnUpdate<TModel>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<TModel>>;

function onUpdateOf<TModel>(data: JSONObject): OnUpdate<TModel> {
  return {
    updateBy: {
      query: { _id: NOTE_ID.toString() },
      data: data,
      props: { isRoot: false, userId: USER_ID, tenantId: PROJECT_ID },
    },
    carryForward: null,
  } as unknown as OnUpdate<TModel>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("IncidentPublicNoteService: editing a public note", () => {
  let createFeedItem: jest.SpiedFunction<
    typeof IncidentFeedService.createIncidentFeedItem
  >;

  beforeEach(() => {
    const incident: Incident = new Incident();
    incident._id = INCIDENT_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 7;

    const note: IncidentPublicNote = new IncidentPublicNote();
    note._id = NOTE_ID.toString();
    note.incidentId = INCIDENT_ID;
    note.projectId = PROJECT_ID;
    note.incident = incident;
    note.note = "Traffic moved to the standby region.";

    jest
      .spyOn(IncidentPublicNoteService, "findBy")
      .mockResolvedValue([note] as never);
    // No attachments.
    jest
      .spyOn(IncidentPublicNoteService, "findOneById")
      .mockResolvedValue(null as never);
    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(
        URL.fromString("https://oneuptime.acme.com/incident/7") as never,
      );
    createFeedItem = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
  });

  test("is logged in the incident feed as a public note, not a private one", async () => {
    await (
      IncidentPublicNoteService as unknown as {
        onUpdateSuccess: OnUpdateSuccess<IncidentPublicNote>;
      }
    ).onUpdateSuccess(
      onUpdateOf<IncidentPublicNote>({ note: "Traffic moved." }),
      [NOTE_ID],
    );

    expect(createFeedItem).toHaveBeenCalledTimes(1);

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(item["incidentFeedEventType"]).toBe(
      IncidentFeedEventType.PublicNote,
    );
    expect(item["incidentFeedEventType"]).not.toBe(
      IncidentFeedEventType.PrivateNote,
    );
    expect(item["feedInfoInMarkdown"]).toContain("updated **Public Note**");
  });

  test("an update that leaves the note alone writes no feed item", async () => {
    await (
      IncidentPublicNoteService as unknown as {
        onUpdateSuccess: OnUpdateSuccess<IncidentPublicNote>;
      }
    ).onUpdateSuccess(
      onUpdateOf<IncidentPublicNote>({ postedAt: new Date() }),
      [NOTE_ID],
    );

    expect(createFeedItem).not.toHaveBeenCalled();
  });
});

describe("ScheduledMaintenancePublicNoteService: editing a public note", () => {
  let createFeedItem: jest.SpiedFunction<
    typeof ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem
  >;

  beforeEach(() => {
    const maintenance: ScheduledMaintenance = new ScheduledMaintenance();
    maintenance._id = MAINTENANCE_ID.toString();
    maintenance.projectId = PROJECT_ID;
    maintenance.scheduledMaintenanceNumber = 3;

    const note: ScheduledMaintenancePublicNote =
      new ScheduledMaintenancePublicNote();
    note._id = NOTE_ID.toString();
    note.scheduledMaintenanceId = MAINTENANCE_ID;
    note.projectId = PROJECT_ID;
    note.scheduledMaintenance = maintenance;
    note.note = "The window moves to Sunday.";

    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "findBy")
      .mockResolvedValue([note] as never);
    jest
      .spyOn(ScheduledMaintenancePublicNoteService, "findOneById")
      .mockResolvedValue(null as never);
    jest
      .spyOn(
        ScheduledMaintenanceService,
        "getScheduledMaintenanceLinkInDashboard",
      )
      .mockResolvedValue(
        URL.fromString(
          "https://oneuptime.acme.com/scheduled-maintenance/3",
        ) as never,
      );
    createFeedItem = jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockResolvedValue(undefined as never);
  });

  test("is logged in the maintenance feed as a public note, not a private one", async () => {
    await (
      ScheduledMaintenancePublicNoteService as unknown as {
        onUpdateSuccess: OnUpdateSuccess<ScheduledMaintenancePublicNote>;
      }
    ).onUpdateSuccess(
      onUpdateOf<ScheduledMaintenancePublicNote>({ note: "Sunday." }),
      [NOTE_ID],
    );

    expect(createFeedItem).toHaveBeenCalledTimes(1);

    const item: JSONObject = createFeedItem.mock
      .calls[0]![0] as unknown as JSONObject;

    expect(item["scheduledMaintenanceFeedEventType"]).toBe(
      ScheduledMaintenanceFeedEventType.PublicNote,
    );
    expect(item["feedInfoInMarkdown"]).toContain("updated **Public Note**");
  });
});
