import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission, { UserPermission } from "Common/Types/Permission";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";

/*
 * SUBSCRIBERS HEAR ABOUT A POSTMORTEM ONCE, WHEN IT IS PUBLISHED - HOWEVER
 * OFTEN IT IS SAVED.
 *
 * The Edit Postmortem form sends the note with every save, and any update
 * that carried the note put the postmortem's subscriber notification back
 * to Pending (found in #4422). So each save of a published postmortem -
 * fixing a typo, adding a follow-up - emailed, texted and messaged every
 * subscriber of its status pages again.
 *
 * This runs it end to end without a database: each save goes through the
 * real incident update hooks, around a write to an in-memory incident; then
 * the real Incident:SendPostmortemNotificationToSubscribers job runs, as the
 * worker would every minute, against that same incident, and every message
 * it sends is counted.
 */

type CronHandler = () => Promise<void>;

const mockCapturedJobs: Record<string, CronHandler> = {};

jest.mock("../../../../FeatureSet/Workers/Utils/Cron", () => {
  return {
    __esModule: true,
    default: jest.fn(
      (jobName: string, _options: unknown, runFunction: CronHandler): void => {
        mockCapturedJobs[jobName] = runFunction;
      },
    ),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and the real services below reach
 * it, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: { hash: jest.fn(), verify: jest.fn() },
  };
});

jest.mock("Common/Server/DatabaseConfig", () => {
  return {
    __esModule: true,
    default: { getHost: jest.fn(), getHttpProtocol: jest.fn() },
  };
});

jest.mock("Common/Server/Services/IncidentFeedService", () => {
  return { __esModule: true, default: { createIncidentFeedItem: jest.fn() } };
});

jest.mock("Common/Server/Services/StatusPageResourceService", () => {
  return { __esModule: true, default: { findByMonitors: jest.fn() } };
});

jest.mock("Common/Server/Services/StatusPageSubscriberService", () => {
  return {
    __esModule: true,
    default: {
      getStatusPagesToSendNotification: jest.fn(),
      getSubscribersByStatusPage: jest.fn(),
      shouldSendNotification: jest.fn(),
      getUnsubscribeLink: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/StatusPageService", () => {
  return {
    __esModule: true,
    default: { getStatusPageURL: jest.fn() },
    Service: {
      getSubscriberEmailFooterText: jest.fn(() => {
        return "Footer text";
      }),
    },
  };
});

jest.mock(
  "Common/Server/Services/StatusPageSubscriberNotificationTemplateService",
  () => {
    return {
      __esModule: true,
      default: { getTemplateForStatusPage: jest.fn() },
      Service: {
        compileEmailBodyTemplate: jest.fn(),
        compileTemplate: jest.fn(),
      },
    };
  },
);

jest.mock("Common/Server/Services/MailService", () => {
  return { __esModule: true, default: { sendMail: jest.fn() } };
});

jest.mock("Common/Server/Services/SmsService", () => {
  return { __esModule: true, default: { sendSms: jest.fn() } };
});

jest.mock("Common/Server/Services/ProjectCallSMSConfigService", () => {
  return {
    __esModule: true,
    default: { toTwilioConfig: jest.fn(() => {}) },
  };
});

jest.mock("Common/Server/Services/ProjectSmtpConfigService", () => {
  return {
    __esModule: true,
    default: { toEmailServer: jest.fn(() => {}) },
  };
});

jest.mock("Common/Server/Utils/Workspace/Slack/Slack", () => {
  return {
    __esModule: true,
    default: {
      sendMessageToChannelViaIncomingWebhook: jest.fn(),
      convertMarkdownToSlackRichText: jest.fn((text: string) => {
        return text;
      }),
    },
  };
});

jest.mock("Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams", () => {
  return {
    __esModule: true,
    default: { sendMessageToChannelViaIncomingWebhook: jest.fn() },
  };
});

jest.mock("Common/Server/Utils/StatusPageSubscriberWebhook", () => {
  return { __esModule: true, default: { sendWebhookNotification: jest.fn() } };
});

// The project's incident custom fields: none here.
jest.mock("Common/Server/Services/IncidentCustomFieldService", () => {
  return { __esModule: true, default: { findBy: jest.fn() } };
});

// The postmortem's inline images: it has none.
jest.mock("Common/Server/Utils/InlineImageAccessTokenSync", () => {
  return {
    __esModule: true,
    setIsPublicForMarkdownImages: jest.fn(),
    syncIsPublicForMarkdownImages: jest.fn(),
  };
});

import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import Semaphore from "Common/Server/Infrastructure/Semaphore";
import CustomFieldMappingService from "Common/Server/Services/CustomFieldMappingService";
import IncidentCustomFieldService from "Common/Server/Services/IncidentCustomFieldService";
import IncidentFeedService from "Common/Server/Services/IncidentFeedService";
import IncidentMeasurementValueService from "Common/Server/Services/IncidentMeasurementValueService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import MailService from "Common/Server/Services/MailService";
import SmsService from "Common/Server/Services/SmsService";
import StatusPageResourceService from "Common/Server/Services/StatusPageResourceService";
import StatusPageService from "Common/Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import { OnUpdate } from "Common/Server/Types/Database/Hooks";
import UpdateBy from "Common/Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "Common/Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator from "Common/Server/Utils/Database/ProjectScopedReferenceValidator";
import SlackUtil from "Common/Server/Utils/Workspace/Slack/Slack";
import MicrosoftTeamsUtil from "Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams";
import StatusPageSubscriberWebhookUtil from "Common/Server/Utils/StatusPageSubscriberWebhook";
import { IncidentFeedEventType } from "Common/Models/DatabaseModels/IncidentFeed";
import IncidentPostmortemPublication from "Common/Types/StatusPage/IncidentPostmortemPublication";
import {
  fakeGetUnsubscribeLink,
  withUnsubscribeToken,
} from "../Fixtures/UnsubscribeLinkFixtures";
import "../../../../FeatureSet/Workers/Jobs/Incident/SendPostmortemNotificationToSubscribers";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const JOB: string = "Incident:SendPostmortemNotificationToSubscribers";

const PROJECT_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000002",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000003",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000004",
);
const SUBSCRIBER_ID: ObjectID = new ObjectID(
  "4f000000-0000-4000-8000-000000000005",
);
const USER_ID: ObjectID = new ObjectID("4f000000-0000-4000-8000-000000000006");

const STATUS_PAGE_URL: string = "https://status.acme.com";
const NOTE: string =
  "## What happened\n\nA bad deploy broke checkout for 12 minutes.";
const EDITED_NOTE: string = `${NOTE}\n\n## Follow-ups\n\n- Add a canary stage.`;
const PUBLISHED_AT: Date = new Date("2026-10-05T09:30:00.000Z");

// The incident as the database holds it.
let incident: Incident;

/*
 * What happens right after the job claims the notification - before it
 * settles it - when a test races an update against it. Runs once.
 */
let afterClaim: (() => Promise<void>) | null = null;

function mock(fn: unknown): jest.Mock {
  return fn as unknown as jest.Mock;
}

type OnBeforeUpdate = (
  updateBy: UpdateBy<Incident>,
) => Promise<OnUpdate<Incident>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<Incident>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<Incident>>;

interface UpdateHooks {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
}

// Someone who may edit incidents.
function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.IncidentMember].map(
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
 * A resolved incident, visible on its status page, with a postmortem written
 * but not published. Declaring it settled the postmortem notification as
 * Skipped: there was nothing on the status page then.
 */
function declaredIncident(): Incident {
  const row: Incident = new Incident();
  row._id = INCIDENT_ID.toString();
  row.projectId = PROJECT_ID;
  row.title = "Checkout errors";
  row.description = "Payments fail in Europe.";
  row.incidentNumber = 7;
  row.incidentNumberWithPrefix = "INC-7";
  row.isVisibleOnStatusPage = true;
  row.isPrivate = false;
  row.isScopedToStatusPages = false;
  row.customFields = {};
  row.labels = [];
  row.postmortemNote = NOTE;
  row.showPostmortemOnStatusPage = false;
  row.notifySubscribersOnPostmortemPublished = true;
  row.subscriberNotificationStatusOnPostmortemPublished =
    StatusPageSubscriberNotificationStatus.Skipped;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical";
  row.incidentSeverity = severity;

  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  row.monitors = [monitor];

  return row;
}

// What the database returns for a read: a copy, as a fresh row would be.
function read(): Incident {
  const copy: Incident = new Incident();
  Object.assign(copy, incident);
  return copy;
}

// Whether the incident holds every value a conditional write expects.
function holds(expected: JSONObject): boolean {
  return Object.keys(expected).every((key: string): boolean => {
    return (incident as unknown as JSONObject)[key] === expected[key];
  });
}

/*
 * An update as the API runs it: the update hooks around the write, the
 * write itself made to the in-memory incident.
 */
async function update(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = editor(),
): Promise<void> {
  const writeAndFinish: () => Promise<void> = await beginUpdate(data, props);

  await writeAndFinish();
}

/*
 * The first half of an update: its onBeforeUpdate, which reads the
 * incident. Returns the second half - the write, then onUpdateSuccess - for
 * a test to run when it wants the write to land.
 */
async function beginUpdate(
  data: JSONObject,
  props: DatabaseCommonInteractionProps = editor(),
): Promise<() => Promise<void>> {
  const hooks: UpdateHooks = IncidentService as unknown as UpdateHooks;

  const onUpdate: OnUpdate<Incident> = await hooks.onBeforeUpdate({
    query: { _id: INCIDENT_ID.toString() } as never,
    data: { ...data } as never,
    props: props,
    limit: 1,
    skip: 0,
  });

  return async (): Promise<void> => {
    Object.assign(incident, onUpdate.updateBy.data);

    await hooks.onUpdateSuccess(onUpdate, [INCIDENT_ID]);
  };
}

// The Edit Postmortem form's save, as data.
function editPostmortemFormSave(values: {
  note: string | null;
  publish: boolean;
}): JSONObject {
  return {
    postmortemNote: values.note,
    postmortemAttachments: [],
    showPostmortemOnStatusPage: values.publish,
    notifySubscribersOnPostmortemPublished: true,
    postmortemPostedAt: values.publish ? PUBLISHED_AT : null,
  } as unknown as JSONObject;
}

// Save Changes on the Edit Postmortem form: every field it has, every time.
async function saveEditPostmortemForm(values: {
  note: string | null;
  publish: boolean;
  notify?: boolean;
}): Promise<void> {
  await update({
    postmortemNote: values.note,
    postmortemAttachments: [],
    showPostmortemOnStatusPage: values.publish,
    notifySubscribersOnPostmortemPublished: values.notify ?? true,
    postmortemPostedAt: values.publish ? PUBLISHED_AT : null,
  } as unknown as JSONObject);
}

// One run of the job, as the worker runs it every minute.
async function runTheJob(): Promise<void> {
  await mockCapturedJobs[JOB]!();
}

interface Sent {
  emails: Array<EmailTemplateType>;
  sms: number;
  slack: number;
  teams: number;
  webhooks: Array<string>;
}

function sent(): Sent {
  return {
    emails: mock(MailService.sendMail).mock.calls.map(
      (call: Array<unknown>) => {
        return (call[0] as { templateType: EmailTemplateType }).templateType;
      },
    ),
    sms: mock(SmsService.sendSms).mock.calls.length,
    slack: mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mock.calls
      .length,
    teams: mock(MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook).mock
      .calls.length,
    webhooks: mock(
      StatusPageSubscriberWebhookUtil.sendWebhookNotification,
    ).mock.calls.map((call: Array<unknown>) => {
      return (call[0] as { payload: { eventType: string } }).payload.eventType;
    }),
  };
}

function sentTimes(times: number): Sent {
  return {
    emails: Array(times).fill(
      EmailTemplateType.SubscriberIncidentPostmortemCreated,
    ),
    sms: times,
    slack: times,
    teams: times,
    webhooks: Array(times).fill("IncidentPostmortemPublished"),
  };
}

const NOTHING_SENT: Sent = sentTimes(0);

// The "Postmortem Note updated" / "cleared" items the saves recorded.
function postmortemNoteFeedItems(): Array<string> {
  return mock(IncidentFeedService.createIncidentFeedItem)
    .mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      };
    })
    .filter(
      (input: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): boolean => {
        return (
          input.incidentFeedEventType === IncidentFeedEventType.PostmortemNote
        );
      },
    )
    .map(
      (input: {
        incidentFeedEventType: IncidentFeedEventType;
        feedInfoInMarkdown: string;
      }): string => {
        return input.feedInfoInMarkdown;
      },
    );
}

function statusPage(): StatusPage {
  const page: StatusPage = new StatusPage();
  page._id = STATUS_PAGE_ID.toString();
  page.projectId = PROJECT_ID;
  page.name = "Acme";
  page.pageTitle = "Acme Status";
  page.isPublicStatusPage = true;
  page.showIncidentsOnStatusPage = true;
  page.onlyShowScopedIncidents = false;
  return page;
}

function resource(): StatusPageResource {
  const row: StatusPageResource = new StatusPageResource();
  row._id = ObjectID.generate().toString();
  row.statusPageId = STATUS_PAGE_ID;
  row.displayName = "Checkout API";
  return row;
}

// One subscriber on every channel.
function subscriber(): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = SUBSCRIBER_ID.toString();
  row.subscriberEmail = new Email("customer@example.com");
  row.subscriberPhone = new Phone("+15555550100");
  row.slackIncomingWebhookUrl = URL.fromString(
    "https://hooks.slack.com/services/T000/B000/XXXX",
  );
  row.microsoftTeamsIncomingWebhookUrl = URL.fromString(
    "https://outlook.office.com/webhook/abc",
  );
  row.subscriberWebhook = URL.fromString("https://hooks.acme.com/status");
  return withUnsubscribeToken(row);
}

beforeEach(() => {
  jest.clearAllMocks();
  incident = declaredIncident();
  afterClaim = null;

  // The update hooks, without a database.
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectScopedReferenceValidator, "validateReferencesBelongToProject")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);
  // Published At moves the incident's metrics; none of that is counted here.
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
  jest.spyOn(Semaphore, "lock").mockResolvedValue(null as never);
  jest.spyOn(Semaphore, "release").mockResolvedValue(undefined as never);

  // The incident table: every read finds the incident as it is now.
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (): Promise<
    Array<Incident>
  > => {
    return [read()];
  }) as never);
  jest
    .spyOn(IncidentService, "findOneById")
    .mockImplementation((async (): Promise<Incident> => {
      return read();
    }) as never);
  jest.spyOn(IncidentService, "findAllBy").mockImplementation((async (
    input: unknown,
  ): Promise<Array<Incident>> => {
    const query: JSONObject = (input as { query: JSONObject }).query;

    return holds(query) ? [read()] : [];
  }) as never);
  // A conditional write - the hooks' queueing, the job's claim.
  jest
    .spyOn(IncidentService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: unknown): Promise<boolean> => {
      const write: { data: JSONObject; expectedData: JSONObject } = input as {
        data: JSONObject;
        expectedData: JSONObject;
      };

      if (!holds(write.expectedData)) {
        return false;
      }

      Object.assign(incident, write.data);

      if (
        write.data["subscriberNotificationStatusOnPostmortemPublished"] ===
          StatusPageSubscriberNotificationStatus.InProgress &&
        afterClaim
      ) {
        const race: () => Promise<void> = afterClaim;
        afterClaim = null;
        await race();
      }

      return true;
    }) as never);
  // The job settling the notification.
  jest.spyOn(IncidentService, "updateOneById").mockImplementation((async (
    input: unknown,
  ): Promise<number> => {
    Object.assign(incident, (input as { data: JSONObject }).data);
    return 1;
  }) as never);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(
      URL.fromString("https://oneuptime.acme.com/dashboard/incident") as never,
    );

  // Everything the job reads about the status page and its subscribers.
  mock(IncidentFeedService.createIncidentFeedItem).mockResolvedValue(
    undefined as never,
  );
  mock(IncidentCustomFieldService.findBy).mockResolvedValue([] as never);
  mock(StatusPageResourceService.findByMonitors).mockResolvedValue([
    resource(),
  ] as never);
  mock(DatabaseConfig.getHost).mockResolvedValue(
    Hostname.fromString("oneuptime.acme.com") as never,
  );
  mock(DatabaseConfig.getHttpProtocol).mockResolvedValue(
    Protocol.HTTPS as never,
  );
  mock(
    StatusPageSubscriberService.getStatusPagesToSendNotification,
  ).mockResolvedValue([statusPage()] as never);
  mock(
    StatusPageSubscriberService.getSubscribersByStatusPage,
  ).mockResolvedValue([subscriber()] as never);
  mock(StatusPageSubscriberService.shouldSendNotification).mockReturnValue(
    true,
  );
  mock(StatusPageSubscriberService.getUnsubscribeLink).mockImplementation(
    fakeGetUnsubscribeLink,
  );
  mock(StatusPageService.getStatusPageURL).mockResolvedValue(
    STATUS_PAGE_URL as never,
  );
  mock(
    StatusPageSubscriberNotificationTemplateService.getTemplateForStatusPage,
  ).mockResolvedValue(null as never);

  mock(MailService.sendMail).mockResolvedValue(undefined as never);
  mock(SmsService.sendSms).mockResolvedValue(undefined as never);
  mock(SlackUtil.sendMessageToChannelViaIncomingWebhook).mockResolvedValue(
    undefined as never,
  );
  mock(
    MicrosoftTeamsUtil.sendMessageToChannelViaIncomingWebhook,
  ).mockResolvedValue(undefined as never);
  mock(
    StatusPageSubscriberWebhookUtil.sendWebhookNotification,
  ).mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a postmortem published from the Edit Postmortem form", () => {
  test("the job is registered", () => {
    expect(mockCapturedJobs[JOB]).toBeDefined();
  });

  test("publishing it tells each subscriber once, on every channel", async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true });

    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(
      incident.subscriberNotificationStatusMessageOnPostmortemPublished,
    ).toBe(IncidentPostmortemPublication.queuedMessage);

    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Success,
    );

    // The email carries the postmortem as it was published.
    expect(
      JSON.stringify(
        (mock(MailService.sendMail).mock.calls[0]![0] as { vars: JSONObject })
          .vars,
      ),
    ).toContain("A bad deploy broke checkout");
  });

  test("saving it again and again - unchanged, a typo fixed, a follow-up added - tells nobody again", async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();

    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();
    await saveEditPostmortemForm({ note: EDITED_NOTE, publish: true });
    await runTheJob();
    await saveEditPostmortemForm({ note: EDITED_NOTE, publish: true });
    await runTheJob();
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
    // The status page shows the edit; the incident feed records it, once.
    expect(incident.postmortemNote).toBe(EDITED_NOTE);
    expect(postmortemNoteFeedItems()).toHaveLength(1);
    expect(postmortemNoteFeedItems()[0]).toContain("Add a canary stage");
  });

  test("taking it off the status page tells nobody; publishing it again tells them a second time", async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();

    await saveEditPostmortemForm({ note: NOTE, publish: false });
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));

    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();

    expect(sent()).toEqual(sentTimes(2));
  });

  test("switched on before the note is written, it tells subscribers when the note makes it show, once", async () => {
    incident.postmortemNote = undefined as unknown as string;

    await saveEditPostmortemForm({ note: null, publish: true });
    await runTheJob();

    // Nothing on the status page yet: nothing to tell.
    expect(sent()).toEqual(NOTHING_SENT);

    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();
    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
  });

  test("published with Notify Subscribers off, it tells nobody, and says why", async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true, notify: false });
    await runTheJob();

    expect(sent()).toEqual(NOTHING_SENT);
    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );
    expect(
      incident.subscriberNotificationStatusMessageOnPostmortemPublished,
    ).toBe(
      "Incident is not set to notify subscribers on postmortem published. Skipping notifications to subscribers.",
    );

    // Saving it again later does not send what was chosen not to send.
    await saveEditPostmortemForm({ note: NOTE, publish: true, notify: true });
    await runTheJob();

    expect(sent()).toEqual(NOTHING_SENT);
  });
});

/*
 * A run of the job reads the incident, claims its notification, then
 * decides from what it read. A publish that lands in between finds the
 * notification on its way, so it queues nothing - and the run, having read
 * the postmortem unpublished, skips it. Whichever way the two interleave,
 * the publish is still announced, once: the job looks again after such a
 * skip, and the update looks again once it is written.
 */
describe("a postmortem published while the job holds its notification", () => {
  beforeEach(() => {
    // Declared moments ago: the 'published' notification is still waiting.
    incident.subscriberNotificationStatusOnPostmortemPublished =
      StatusPageSubscriberNotificationStatus.Pending;
  });

  test("published right after the claim: the job queues it again, and the next run tells each subscriber once", async () => {
    afterClaim = async (): Promise<void> => {
      await update(editPostmortemFormSave({ note: NOTE, publish: true }));
    };

    await runTheJob();

    // This run skipped what it read, then saw the publish and queued it.
    expect(sent()).toEqual(NOTHING_SENT);
    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );

    await runTheJob();
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
  });

  test("read while the job held it, written after the job skipped it: the update queues it, and the next run tells each subscriber once", async () => {
    let writeAndFinish: (() => Promise<void>) | null = null;

    afterClaim = async (): Promise<void> => {
      writeAndFinish = await beginUpdate(
        editPostmortemFormSave({ note: NOTE, publish: true }),
      );
    };

    await runTheJob();

    // The run skipped it and looked again before the write landed.
    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Skipped,
    );

    await writeAndFinish!();

    expect(incident.subscriberNotificationStatusOnPostmortemPublished).toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );

    await runTheJob();
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
  });

  test("published before the job reads it: the run sends it, and nothing queues it twice", async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true });

    await runTheJob();
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
  });
});

describe("a published postmortem written by something other than the form", () => {
  beforeEach(async () => {
    await saveEditPostmortemForm({ note: NOTE, publish: true });
    await runTheJob();
    jest.clearAllMocks();
  });

  test("an API client writing the whole incident back tells nobody again", async () => {
    await update({
      title: incident.title!,
      description: incident.description!,
      isVisibleOnStatusPage: true,
      postmortemNote: incident.postmortemNote!,
      showPostmortemOnStatusPage: true,
      notifySubscribersOnPostmortemPublished: true,
      postmortemPostedAt: PUBLISHED_AT,
    } as unknown as JSONObject);
    await runTheJob();

    expect(sent()).toEqual(NOTHING_SENT);
    expect(postmortemNoteFeedItems()).toEqual([]);
  });

  test("the API's Pending - its way of sending it again - sends it again, once", async () => {
    await update({
      subscriberNotificationStatusOnPostmortemPublished:
        StatusPageSubscriberNotificationStatus.Pending,
    } as unknown as JSONObject);
    await runTheJob();
    await runTheJob();

    expect(sent()).toEqual(sentTimes(1));
  });
});
