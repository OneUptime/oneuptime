import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import MailService from "../../../Server/Services/MailService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberNotificationTemplateService from "../../../Server/Services/StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberService from "../../../Server/Services/StatusPageSubscriberService";
import Hostname from "../../../Types/API/Hostname";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Protocol from "../../../Types/API/Protocol";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  MonitorGroupMembershipRow,
  StatusPageResourceRow,
  useMonitorGroupStatusPageRows,
} from "../../Helpers/MonitorGroupStatusPageRows";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The "scheduled" and reminder notifications of a scheduled maintenance
 * event (ScheduledMaintenanceService.notififySubscribersOnEventScheduled), on
 * a status page that lets subscribers choose resources, for an event on a
 * monitor the page shows through a monitor group.
 *
 * Runs the real lookup from monitors to resources
 * (AffectedStatusPageResources -> StatusPageResourceService.findByMonitors)
 * against fake rows, and the real decision
 * (StatusPageSubscriberService.shouldSendNotification): a subscriber who
 * picked the group is told, once; one who picked another resource is not.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const EVENT_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");

const PUBLIC_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const EU_PAGE: string = "b0000000-0000-4000-8000-000000000002";

const API_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const DB_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const INVOICES_MONITOR: string = "c0000000-0000-4000-8000-000000000003";

const BACKEND_GROUP: string = "90000000-0000-4000-8000-000000000001";
const BILLING_GROUP: string = "90000000-0000-4000-8000-000000000002";

const MEMBERSHIPS: Array<MonitorGroupMembershipRow> = [
  {
    _id: "f0000000-0000-4000-8000-000000000001",
    monitorGroupId: BACKEND_GROUP,
    monitorId: DB_MONITOR,
  },
  {
    _id: "f0000000-0000-4000-8000-000000000002",
    monitorGroupId: BILLING_GROUP,
    monitorId: INVOICES_MONITOR,
  },
];

// The public page lists the API, and the backend and billing groups.
const PUBLIC_API: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000001",
  statusPageId: PUBLIC_PAGE,
  displayName: "API",
  monitorId: API_MONITOR,
};
const PUBLIC_BACKEND: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000002",
  statusPageId: PUBLIC_PAGE,
  displayName: "Backend",
  monitorGroupId: BACKEND_GROUP,
};
const PUBLIC_BILLING: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000003",
  statusPageId: PUBLIC_PAGE,
  displayName: "Billing",
  monitorGroupId: BILLING_GROUP,
};
// The EU page lists the database directly and through the backend group.
const EU_DB: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000004",
  statusPageId: EU_PAGE,
  displayName: "Database",
  monitorId: DB_MONITOR,
};
const EU_BACKEND: StatusPageResourceRow = {
  _id: "e0000000-0000-4000-8000-000000000005",
  statusPageId: EU_PAGE,
  displayName: "Backend",
  monitorGroupId: BACKEND_GROUP,
};

let subscribersByPage: Record<string, Array<StatusPageSubscriber>> = {};

function accepted(): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, {}, {});
}

function page(id: string, name: string): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = id;
  statusPage.projectId = PROJECT_ID;
  statusPage.name = name;
  statusPage.pageTitle = name;
  statusPage.isPublicStatusPage = true;
  statusPage.showScheduledMaintenanceEventsOnStatusPage = true;
  statusPage.allowSubscribersToChooseResources = true;
  statusPage.allowSubscribersToChooseEventTypes = false;
  statusPage.subscriberTimezones = [];
  return statusPage;
}

function subscriber(data: {
  statusPageId: string;
  email: string;
  picked?: Array<StatusPageResourceRow> | undefined;
}): StatusPageSubscriber {
  const row: StatusPageSubscriber = new StatusPageSubscriber();
  row._id = ObjectID.generate().toString();
  row.statusPageId = new ObjectID(data.statusPageId);
  row.isUnsubscribed = false;
  row.isSubscribedToAllResources = data.picked === undefined;
  row.isSubscribedToAllEventTypes = true;
  row.subscriberEmail = new Email(data.email);
  row.unsubscribeToken = "7a".repeat(32);
  row.statusPageResources = (data.picked || []).map(
    (picked: StatusPageResourceRow): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = picked._id;
      return resource;
    },
  );
  return row;
}

function scheduledEvent(monitorIds: Array<string>): ScheduledMaintenance {
  const event: ScheduledMaintenance = new ScheduledMaintenance();
  event._id = EVENT_ID.toString();
  event.projectId = PROJECT_ID;
  event.title = "Database upgrade";
  event.description = "Upgrading the primary.";
  event.startsAt = new Date("2026-03-04T06:00:00.000Z");
  event.monitors = monitorIds.map((id: string): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    return monitor;
  });
  event.statusPages = [PUBLIC_PAGE, EU_PAGE].map((id: string): StatusPage => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = id;
    return statusPage;
  });
  return event;
}

// Each email sent: who it went to and the resources it listed.
function sentEmails(): Array<{ to: string; resourcesAffected: string }> {
  return (MailService.sendMail as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): { to: string; resourcesAffected: string } => {
      const mail: { toEmail: Email; vars: Record<string, string> } =
        call[0] as { toEmail: Email; vars: Record<string, string> };

      return {
        to: mail.toEmail.toString(),
        resourcesAffected: mail.vars["resourcesAffected"] || "",
      };
    },
  );
}

describe("scheduled maintenance 'scheduled' and reminder notifications reach a monitor group's subscribers", () => {
  beforeEach(() => {
    useMonitorGroupStatusPageRows({
      resources: [
        PUBLIC_API,
        PUBLIC_BACKEND,
        PUBLIC_BILLING,
        EU_DB,
        EU_BACKEND,
      ],
      memberships: MEMBERSHIPS,
    });

    subscribersByPage = {
      [PUBLIC_PAGE]: [
        subscriber({ statusPageId: PUBLIC_PAGE, email: "everything@acme.com" }),
        subscriber({
          statusPageId: PUBLIC_PAGE,
          email: "backend@acme.com",
          picked: [PUBLIC_BACKEND],
        }),
        subscriber({
          statusPageId: PUBLIC_PAGE,
          email: "billing@acme.com",
          picked: [PUBLIC_BILLING],
        }),
        subscriber({
          statusPageId: PUBLIC_PAGE,
          email: "api@acme.com",
          picked: [PUBLIC_API],
        }),
      ],
      [EU_PAGE]: [
        subscriber({
          statusPageId: EU_PAGE,
          email: "database-and-backend@acme.com",
          picked: [EU_DB, EU_BACKEND],
        }),
      ],
    };

    jest
      .spyOn(DatabaseConfig, "getHost")
      .mockResolvedValue(new Hostname("oneuptime.com"));
    jest
      .spyOn(DatabaseConfig, "getHttpProtocol")
      .mockResolvedValue(Protocol.HTTPS);
    jest
      .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
      .mockResolvedValue([
        page(PUBLIC_PAGE, "Acme Status"),
        page(EU_PAGE, "Acme EU"),
      ]);
    jest
      .spyOn(StatusPageSubscriberService, "getSubscribersByStatusPage")
      .mockImplementation(
        async (
          statusPageId: ObjectID,
        ): Promise<Array<StatusPageSubscriber>> => {
          return subscribersByPage[statusPageId.toString()] || [];
        },
      );
    jest
      .spyOn(StatusPageService, "getStatusPageURL")
      .mockResolvedValue("https://status.acme.com");
    jest
      .spyOn(
        StatusPageSubscriberNotificationTemplateService,
        "getTemplateForStatusPage",
      )
      .mockResolvedValue(null);
    jest.spyOn(MailService, "sendMail").mockResolvedValue(accepted());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("tells the subscribers of the group that holds the monitor, and not those of other resources", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent([DB_MONITOR]),
    ]);

    expect(sentEmails()).toEqual([
      { to: "everything@acme.com", resourcesAffected: "Backend" },
      { to: "backend@acme.com", resourcesAffected: "Backend" },
      {
        to: "database-and-backend@acme.com",
        resourcesAffected: "Database, Backend",
      },
    ]);
  });

  test("tells someone who picked both the monitor and its group once", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent([DB_MONITOR]),
    ]);

    expect(
      sentEmails().filter((email: { to: string }): boolean => {
        return email.to === "database-and-backend@acme.com";
      }),
    ).toHaveLength(1);
  });

  test("an event on a monitor listed directly tells that monitor's subscribers, and no group's", async () => {
    await ScheduledMaintenanceService.notififySubscribersOnEventScheduled([
      scheduledEvent([API_MONITOR]),
    ]);

    expect(
      sentEmails().map((email: { to: string }): string => {
        return email.to;
      }),
    ).toEqual(["everything@acme.com", "api@acme.com"]);
  });
});
