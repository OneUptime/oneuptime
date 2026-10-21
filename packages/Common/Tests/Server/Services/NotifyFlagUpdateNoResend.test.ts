import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentCreatedRenotify from "../../../Types/StatusPage/IncidentCreatedRenotify";
import IncidentCreatedResend from "../../../Types/StatusPage/IncidentCreatedResend";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "../../../Types/StatusPage/SubscriberUpdateNotification";
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
 * "Notify status page subscribers" on an incident, a scheduled maintenance
 * event and an announcement is the choice made when the record is created:
 * whether its 'created' message goes out. No role may change it afterwards
 * (its update list is empty), but a workflow and the server's own code write
 * as root, and a master admin skips the column checks - and an update that
 * so much as carried the flag as true put the 'created' message back to
 * Pending. A workflow or a master-key API client that writes the whole record
 * back re-sent "incident created", "maintenance scheduled" or the
 * announcement to every subscriber, and an incident's record of the status
 * pages it told was emptied in the same write, so every page heard it again.
 *
 * What holds now:
 *   - writing the flag in an update never touches the 'created' message: not
 *     its status, not its message, not an incident's record of told pages.
 *     That goes for re-sending the value the record holds, for turning the
 *     flag off (a message still queued is skipped by its job when it would go
 *     out, as the flag is read there) and for turning it on (the message went
 *     out, or was deliberately not sent, when the record was created; Retry,
 *     Resend and the API's Pending are how it is sent again);
 *   - the explicit requests still work, with or without the flag beside them;
 *   - what an incident update decides from the flag - publishing a hidden
 *     incident, adding status pages - reads the flag as it is after the
 *     update.
 *
 * The database is stubbed: each service's reads are served the stored rows
 * below, and nothing is written.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-f1a9-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-f1a9-4aaa-8bbb-000000000002");
const ROW_ID: string = "0193c0de-f1a9-4aaa-8bbb-0000000000a1";
const PAGE_A: string = "0193c0de-f1a9-4aaa-8bbb-0000000000b1";
const PAGE_B: string = "0193c0de-f1a9-4aaa-8bbb-0000000000b2";

type OnBeforeUpdate = (
  updateBy: UpdateBy<BaseModel>,
) => Promise<OnUpdate<BaseModel>>;

interface FlagCase {
  name: string;
  service: { findBy: unknown };
  modelType: { new (): BaseModel };
  flagColumn: string;
  statusColumn: string;
  // Every column the 'created' message keeps its state in.
  messageColumns: Array<string>;
}

const FLAG_CASES: Array<FlagCase> = [
  {
    name: "incident",
    service: IncidentService as unknown as { findBy: unknown },
    modelType: Incident,
    flagColumn: "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated",
    statusColumn: "subscriberNotificationStatusOnIncidentCreated",
    messageColumns: [
      "subscriberNotificationStatusOnIncidentCreated",
      "subscriberNotificationStatusMessage",
      "statusPagesNotifiedOnCreation",
    ],
  },
  {
    name: "scheduled maintenance event",
    service: ScheduledMaintenanceService as unknown as { findBy: unknown },
    modelType: ScheduledMaintenance,
    flagColumn: "shouldStatusPageSubscribersBeNotifiedOnEventCreated",
    statusColumn: "subscriberNotificationStatusOnEventScheduled",
    messageColumns: [
      "subscriberNotificationStatusOnEventScheduled",
      "subscriberNotificationStatusMessage",
    ],
  },
  {
    name: "announcement",
    service: StatusPageAnnouncementService as unknown as { findBy: unknown },
    modelType: StatusPageAnnouncement,
    flagColumn: "shouldStatusPageSubscribersBeNotified",
    statusColumn: "subscriberNotificationStatus",
    messageColumns: [
      "subscriberNotificationStatus",
      "subscriberNotificationStatusMessage",
    ],
  },
];

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

function masterAdmin(): DatabaseCommonInteractionProps {
  return {
    isMasterAdmin: true,
    userId: USER_ID,
    tenantId: PROJECT_ID,
  };
}

const CALLERS: Array<[string, () => DatabaseCommonInteractionProps]> = [
  [
    "a workflow (root)",
    (): DatabaseCommonInteractionProps => {
      return { ...ROOT };
    },
  ],
  ["a master admin", masterAdmin],
];

// The record as stored: the flag and the 'created' message's state.
function storedRow(
  flagCase: FlagCase,
  stored: {
    flag: boolean;
    status: StatusPageSubscriberNotificationStatus;
  },
): BaseModel {
  const row: BaseModel = new flagCase.modelType();
  const record: Record<string, unknown> = row as unknown as Record<
    string,
    unknown
  >;

  row._id = ROW_ID;
  record["projectId"] = PROJECT_ID;
  record["isVisibleOnStatusPage"] = true;
  record["isPrivate"] = false;
  record[flagCase.flagColumn] = stored.flag;
  record[flagCase.statusColumn] = stored.status;
  record["subscriberNotificationStatusMessage"] =
    "Notifications sent successfully to all subscribers";

  if (flagCase.modelType === Incident) {
    // It told page A; the record is what keeps page A from hearing it twice.
    record["statusPagesNotifiedOnCreation"] = [PAGE_A];
  }

  return row;
}

let storedRows: Array<BaseModel> = [];
let findByMock: MockFunction;

function stubService(flagCase: FlagCase): void {
  findByMock = getJestMockFunction();
  findByMock.mockImplementation(() => {
    return Promise.resolve(storedRows);
  });

  jest
    .spyOn(flagCase.service as { findBy: () => Promise<unknown> }, "findBy")
    .mockImplementation(findByMock as never);
}

async function runBeforeUpdate(
  flagCase: FlagCase,
  data: JSONObject,
  options: {
    props?: DatabaseCommonInteractionProps;
    miscDataProps?: JSONObject;
  } = {},
): Promise<Record<string, unknown>> {
  const updateBy: UpdateBy<BaseModel> = {
    query: { _id: ROW_ID } as UpdateBy<BaseModel>["query"],
    data: data as UpdateBy<BaseModel>["data"],
    props: options.props || { ...ROOT },
    limit: 1,
    skip: 0,
  };

  if (options.miscDataProps) {
    updateBy.miscDataProps = options.miscDataProps;
  }

  const onUpdate: OnUpdate<BaseModel> = await (
    flagCase.service as unknown as { onBeforeUpdate: OnBeforeUpdate }
  ).onBeforeUpdate(updateBy);

  return onUpdate.updateBy.data as unknown as Record<string, unknown>;
}

function expectMessageUntouched(
  flagCase: FlagCase,
  data: Record<string, unknown>,
): void {
  for (const column of flagCase.messageColumns) {
    expect({ column: column, value: data[column] }).toEqual({
      column: column,
      value: undefined,
    });
  }
}

beforeEach(() => {
  stubProjectDirectory({});

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(FLAG_CASES)(
  "an update of a $name that writes the notify flag",
  (flagCase: FlagCase) => {
    beforeEach(() => {
      stubService(flagCase);
    });

    describe.each(CALLERS)(
      "written by %s",
      (_caller: string, props: () => DatabaseCommonInteractionProps) => {
        test("re-sending the flag the record holds, after its message went out, re-sends nothing", async () => {
          storedRows = [
            storedRow(flagCase, {
              flag: true,
              status: StatusPageSubscriberNotificationStatus.Success,
            }),
          ];

          const data: Record<string, unknown> = await runBeforeUpdate(
            flagCase,
            { [flagCase.flagColumn]: true },
            { props: props() },
          );

          expectMessageUntouched(flagCase, data);
          // The flag itself is written as sent.
          expect(data[flagCase.flagColumn]).toBe(true);
        });

        test("a whole record written back, the flag among its columns, re-sends nothing", async () => {
          storedRows = [
            storedRow(flagCase, {
              flag: true,
              status: StatusPageSubscriberNotificationStatus.Success,
            }),
          ];

          const data: Record<string, unknown> = await runBeforeUpdate(
            flagCase,
            {
              title: "Database failover",
              description: "Failing over the primary.",
              [flagCase.flagColumn]: true,
            },
            { props: props() },
          );

          expectMessageUntouched(flagCase, data);
          expect(data["title"]).toBe("Database failover");
        });

        test.each([
          StatusPageSubscriberNotificationStatus.Success,
          StatusPageSubscriberNotificationStatus.Failed,
          StatusPageSubscriberNotificationStatus.InProgress,
          StatusPageSubscriberNotificationStatus.Pending,
          StatusPageSubscriberNotificationStatus.Skipped,
        ])(
          "turning the flag off leaves a message that is %s alone",
          async (status: StatusPageSubscriberNotificationStatus) => {
            storedRows = [storedRow(flagCase, { flag: true, status: status })];

            const data: Record<string, unknown> = await runBeforeUpdate(
              flagCase,
              { [flagCase.flagColumn]: false },
              { props: props() },
            );

            expectMessageUntouched(flagCase, data);
            expect(data[flagCase.flagColumn]).toBe(false);
          },
        );

        test("turning the flag on after creation does not send the message the record was created without", async () => {
          storedRows = [
            storedRow(flagCase, {
              flag: false,
              status: StatusPageSubscriberNotificationStatus.Skipped,
            }),
          ];

          const data: Record<string, unknown> = await runBeforeUpdate(
            flagCase,
            { [flagCase.flagColumn]: true },
            { props: props() },
          );

          expectMessageUntouched(flagCase, data);
          expect(data[flagCase.flagColumn]).toBe(true);
        });

        test("re-sending a flag that is off changes nothing either", async () => {
          storedRows = [
            storedRow(flagCase, {
              flag: false,
              status: StatusPageSubscriberNotificationStatus.Skipped,
            }),
          ];

          const data: Record<string, unknown> = await runBeforeUpdate(
            flagCase,
            { [flagCase.flagColumn]: false },
            { props: props() },
          );

          expectMessageUntouched(flagCase, data);
        });
      },
    );

    test("an update that leaves the flag out leaves the message alone too", async () => {
      storedRows = [
        storedRow(flagCase, {
          flag: true,
          status: StatusPageSubscriberNotificationStatus.Success,
        }),
      ];

      const data: Record<string, unknown> = await runBeforeUpdate(flagCase, {
        title: "Renamed",
      });

      expectMessageUntouched(flagCase, data);
    });
  },
);

describe("the explicit ways of sending an incident's 'created' message again still work", () => {
  const incidentCase: FlagCase = FLAG_CASES[0]!;

  beforeEach(() => {
    stubService(incidentCase);
    storedRows = [
      storedRow(incidentCase, {
        flag: true,
        status: StatusPageSubscriberNotificationStatus.Success,
      }),
    ];
  });

  test("the API's Pending, sent with the flag beside it, resends to every page as documented", async () => {
    const data: Record<string, unknown> = await runBeforeUpdate(incidentCase, {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    // The record is emptied with it, so every page hears it again.
    expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
  });

  test("the API's Pending after a failure resumes where the send stopped", async () => {
    storedRows = [
      storedRow(incidentCase, {
        flag: true,
        status: StatusPageSubscriberNotificationStatus.Failed,
      }),
    ];

    const data: Record<string, unknown> = await runBeforeUpdate(incidentCase, {
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      subscriberNotificationStatusOnIncidentCreated:
        StatusPageSubscriberNotificationStatus.Pending,
    });

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["statusPagesNotifiedOnCreation"]).toBeUndefined();
  });

  test("Resend to all pages, with the flag beside it, queues it once with its own message", async () => {
    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      { shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true },
      { miscDataProps: IncidentCreatedResend.getMiscDataProps() },
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedResend.queuedMessage,
    );
    expect(data["statusPagesNotifiedOnCreation"]).toEqual([]);
  });
});

describe("what an incident update decides from the flag reads it as it is after the update", () => {
  const incidentCase: FlagCase = FLAG_CASES[0]!;

  beforeEach(() => {
    stubService(incidentCase);

    // Every page asked about is one the caller can read.
    jest.spyOn(StatusPageService, "findBy").mockImplementation((async (findBy: {
      query: { _id: unknown };
    }): Promise<Array<unknown>> => {
      void findBy;
      return [];
    }) as never);
  });

  function hiddenIncident(flag: boolean): BaseModel {
    const row: BaseModel = storedRow(incidentCase, {
      flag: flag,
      status: StatusPageSubscriberNotificationStatus.Skipped,
    });

    (row as Incident).isVisibleOnStatusPage = false;
    (row as Incident).subscriberNotificationStatusMessage =
      IncidentCreatedRenotify.hiddenFromStatusPagesMessage;
    (row as Incident).statusPagesNotifiedOnCreation = null as never;

    return row;
  }

  test("publishing with the box ticked while the same update turns the flag off queues nothing", async () => {
    storedRows = [hiddenIncident(true)];

    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      {
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      },
      { miscDataProps: IncidentCreatedRenotify.getMiscDataProps() },
    );

    expectMessageUntouched(incidentCase, data);
  });

  test("publishing with the box ticked while the same update turns the flag on queues it, as the box asks", async () => {
    storedRows = [hiddenIncident(false)];

    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      {
        isVisibleOnStatusPage: true,
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
      },
      { miscDataProps: IncidentCreatedRenotify.getMiscDataProps() },
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatusMessage"]).toBe(
      IncidentCreatedRenotify.queuedMessage,
    );
  });

  test("publishing with the box ticked and the flag on as stored queues it, as before", async () => {
    storedRows = [hiddenIncident(true)];

    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      { isVisibleOnStatusPage: true },
      { miscDataProps: IncidentCreatedRenotify.getMiscDataProps() },
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });

  test("adding status pages with the box ticked while the same update turns the flag off queues nothing", async () => {
    const stored: Incident = storedRow(incidentCase, {
      flag: true,
      status: StatusPageSubscriberNotificationStatus.Success,
    }) as Incident;

    stored.statusPagesNotifiedOnCreation = [PAGE_A];
    stored.statusPages = [{ _id: PAGE_A } as never];

    storedRows = [stored];

    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      {
        statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }],
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: false,
      },
      {
        miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
      },
    );

    expect(
      data["subscriberNotificationStatusOnIncidentCreated"],
    ).toBeUndefined();
    expect(data["subscriberNotificationStatusMessage"]).toBeUndefined();
    // The record of told pages is left as it is.
    expect(data["statusPagesNotifiedOnCreation"]).toBeUndefined();
  });

  test("adding status pages with the box ticked and the flag on queues it for the added page, as before", async () => {
    const stored: Incident = storedRow(incidentCase, {
      flag: true,
      status: StatusPageSubscriberNotificationStatus.Success,
    }) as Incident;

    stored.statusPagesNotifiedOnCreation = [PAGE_A];
    stored.statusPages = [{ _id: PAGE_A } as never];

    storedRows = [stored];

    const data: Record<string, unknown> = await runBeforeUpdate(
      incidentCase,
      { statusPages: [{ _id: PAGE_A }, { _id: PAGE_B }] },
      {
        miscDataProps: IncidentScopeAddedPagesNotification.getMiscDataProps(),
      },
    );

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
  });
});

describe("an announcement's notify flag and its update notification are independent", () => {
  const announcementCase: FlagCase = FLAG_CASES[2]!;

  beforeEach(() => {
    stubService(announcementCase);
    storedRows = [
      storedRow(announcementCase, {
        flag: true,
        status: StatusPageSubscriberNotificationStatus.Success,
      }),
    ];
  });

  test("an edit that asks to tell subscribers about it queues that message alone, whatever the flag", async () => {
    const data: Record<string, unknown> = await runBeforeUpdate(
      announcementCase,
      { title: "New title", shouldStatusPageSubscribersBeNotified: true },
      { miscDataProps: SubscriberUpdateNotification.getMiscDataProps() },
    );

    expect(data["subscriberNotificationStatusOnAnnouncementUpdated"]).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["subscriberNotificationStatus"]).toBeUndefined();
  });
});
