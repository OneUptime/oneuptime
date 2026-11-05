import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import OpenStackProjectNotice from "../../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackProjectNoticeDelivery from "../../../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import OpenStackResource from "../../../../Models/DatabaseModels/OpenStackResource";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import URL from "../../../../Types/API/URL";
import Email from "../../../../Types/Email";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
} from "../../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../../Types/OpenStack/OpenStackResourceKind";
import API from "../../../../Utils/API";
import IncidentService from "../../../../Server/Services/IncidentService";
import MailService from "../../../../Server/Services/MailService";
import OpenStackProjectNoticeDeliveryService, {
  OpenStackProjectNoticeDeliveryToRecord,
} from "../../../../Server/Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "../../../../Server/Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../../../../Server/Services/OpenStackResourceService";
import ProjectService from "../../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import OpenStackProjectNoticeSender from "../../../../Server/Utils/OpenStack/OpenStackProjectNoticeSender";
import SSRFProtection from "../../../../Server/Utils/SSRFProtection";

/*
 * WHAT GOES OUT, AND WHAT DOESN'T, ON THE WAY OUT.
 *
 * Between a part failing and its notice going out is a minute in which anything can change, and a send
 * that fails can't become two. Rows and answers stood in for: the statements that make a row unique and
 * take it for one worker are held by OpenStackProjectNoticePostgres.
 */
const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const NOTICE_ID: ObjectID = ObjectID.generate();
const INCIDENT_ID: ObjectID = ObjectID.generate();
const KEYSTONE_ID: string = "aaaabbbbccccdddd";
const EMAIL: string = "ops@example.com";

type Row = OpenStackProjectNoticeDelivery;

function rowOf(overrides: Partial<Row> = {}): Row {
  const row: OpenStackProjectNoticeDelivery =
    new OpenStackProjectNoticeDelivery();
  row._id = ObjectID.generate().toString();
  row.projectId = PROJECT_ID;
  row.openStackCloudId = CLOUD_ID;
  row.openStackProjectNoticeId = NOTICE_ID;
  row.openStackProjectId = KEYSTONE_ID;
  row.event = OpenStackProjectNoticeEvent.IncidentOpened;
  row.dedupeKey = `incident:${INCIDENT_ID.toString()}:opened`;
  row.partKey = "host:RegionOne/compute-01";
  row.incidentId = INCIDENT_ID;
  row.status = OpenStackProjectNoticeDeliveryStatus.Pending;
  row.attempts = 0;
  row.facts = {
    event: OpenStackProjectNoticeEvent.IncidentOpened,
    projectId: KEYSTONE_ID,
    projectName: "ou-payments",
    partKind: OpenStackResourceKind.Hypervisor,
    partWords: "A compute host",
    regionName: "RegionOne",
    holdings: { instanceCount: 3 },
    occurredAt: "2026-11-05T10:00:00.000Z",
  };
  Object.assign(row, overrides);
  return row;
}

function noticeOf(overrides: Partial<OpenStackProjectNotice> = {}): OpenStackProjectNotice {
  const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
  notice._id = NOTICE_ID.toString();
  notice.id = NOTICE_ID;
  notice.openStackProjectId = KEYSTONE_ID;
  notice.email = new Email(EMAIL);
  notice.isEnabled = true;
  notice.previewSeenAt = new Date("2026-11-05T09:00:00.000Z");
  notice.previewedRecipient = `email:${EMAIL}`;
  Object.assign(notice, overrides);
  return notice;
}

function webhookNotice(url: string = "https://example.com/hook"): OpenStackProjectNotice {
  const notice: OpenStackProjectNotice = noticeOf();
  notice.email = undefined;
  notice.webhookUrl = URL.fromString(url);
  notice.previewedRecipient = `webhook:${URL.fromString(url).toString()}`;
  return notice;
}

interface Sent {
  deliveries: Array<Row>;
  updates: Array<{ id: string; data: Partial<Row> }>;
  recorded: Array<OpenStackProjectNoticeDeliveryToRecord>;
  emails: ReturnType<typeof jest.spyOn>;
  webhooks: ReturnType<typeof jest.spyOn>;
}

function arrange(data: {
  pending?: Array<Row>;
  notice?: OpenStackProjectNotice | null;
  projectExists?: boolean;
  repeatOf?: Row | null;
}): Sent {
  const updates: Sent["updates"] = [];
  const recorded: Sent["recorded"] = [];
  const deliveries: Array<Row> = data.pending || [];

  jest
    .spyOn(OpenStackProjectNoticeDeliveryService, "findBy")
    .mockImplementation((async (args: { query: Record<string, unknown> }) => {
      return args.query["status"] === OpenStackProjectNoticeDeliveryStatus.Pending
        ? deliveries
        : [];
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeDeliveryService, "findOneBy")
    .mockImplementation((async () => {
      return data.repeatOf || null;
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeDeliveryService, "claimForSending")
    .mockResolvedValue(true);
  jest
    .spyOn(OpenStackProjectNoticeDeliveryService, "updateOneById")
    .mockImplementation((async (args: { id: ObjectID; data: Partial<Row> }) => {
      updates.push({ id: args.id.toString(), data: args.data });
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeDeliveryService, "recordIfNew")
    .mockImplementation((async (
      rows: ReadonlyArray<OpenStackProjectNoticeDeliveryToRecord>,
    ) => {
      recorded.push(...rows);
      return rows.length;
    }) as never);
  jest
    .spyOn(OpenStackProjectNoticeService, "findOneById")
    .mockResolvedValue(data.notice === undefined ? noticeOf() : data.notice);
  jest.spyOn(OpenStackResourceService, "findBy").mockImplementation((async (args: {
    query: { kind: string };
  }) => {
    if (
      args.query.kind === OpenStackResourceKind.Project &&
      data.projectExists !== false
    ) {
      const project: OpenStackResource = new OpenStackResource();
      project.externalId = KEYSTONE_ID;
      return [project];
    }
    return [];
  }) as never);
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest
    .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
    .mockResolvedValue(undefined);

  return {
    deliveries,
    updates,
    recorded,
    emails: jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never),
    webhooks: jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never),
  };
}

function lastStatus(sent: Sent): OpenStackProjectNoticeDeliveryStatus | undefined {
  return sent.updates[sent.updates.length - 1]?.data.status;
}

describe("sending what is waiting", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an email goes to the recipient, with its own words and nothing else's", async () => {
    const sent: Sent = arrange({ pending: [rowOf()] });

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).toHaveBeenCalledTimes(1);
    const mail: {
      toEmail: Email;
      subject: string;
      isSubjectLiteral: boolean;
      vars: { message: string };
    } = (sent.emails.mock.calls[0] as Array<never>)[0]!;
    expect(mail.toEmail.toString()).toBe(EMAIL);
    expect(mail.isSubjectLiteral).toBe(true);
    expect(mail.subject).toContain("ou-payments");
    expect(mail.vars.message).toContain("3 instances");
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Sent);
    expect(sent.webhooks).not.toHaveBeenCalled();
  });

  test("a webhook gets a stable id, twice over, and never follows a redirect", async () => {
    const row: Row = rowOf();
    const sent: Sent = arrange({ pending: [row], notice: webhookNotice() });

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.webhooks).toHaveBeenCalledTimes(1);
    const call: {
      data: JSONObject;
      headers: Record<string, string>;
      options: { retries: number; doNotFollowRedirects: boolean };
    } = (sent.webhooks.mock.calls[0] as Array<never>)[0]!;
    expect(call.data["id"]).toBe(row._id);
    expect(call.headers["Idempotency-Key"]).toBe(row._id);
    expect(call.options.doNotFollowRedirects).toBe(true);
    expect(call.options.retries).toBe(0);
    expect(call.data["kind"]).toBe("openstack.project.notice");
    expect(sent.emails).not.toHaveBeenCalled();
  });

  test.each<[string, Parameters<typeof arrange>[0], string]>([
    [
      "turned off in the minute before it went out",
      { notice: noticeOf({ isEnabled: false }) },
      "turned off",
    ],
    [
      "its address changed, so it is no longer who was seen",
      {
        notice: Object.assign(noticeOf(), {
          email: new Email("someone-else@example.com"),
        }),
      },
      "turned off",
    ],
    ["deleted", { notice: null }, "deleted"],
    ["its project went", { projectExists: false }, "no longer in this cloud"],
    [
      "already told about this part, and that is not over",
      { repeatOf: rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent }) },
      "already been told",
    ],
  ])("%s: nothing goes out", async (_name, data, why) => {
    const sent: Sent = arrange({ pending: [rowOf()], ...data });

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).not.toHaveBeenCalled();
    expect(sent.webhooks).not.toHaveBeenCalled();
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Skipped);
    expect(sent.updates[sent.updates.length - 1]!.data.statusMessage).toContain(
      why,
    );
  });

  test("over before it went out: nothing goes out", async () => {
    const sent: Sent = arrange({
      pending: [rowOf({ closedAt: new Date() })],
    });

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).not.toHaveBeenCalled();
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Skipped);
  });

  test("taken by another worker: nothing goes out, and nothing is said of it", async () => {
    const sent: Sent = arrange({ pending: [rowOf()] });
    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "claimForSending")
      .mockResolvedValue(false);

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).not.toHaveBeenCalled();
    expect(sent.updates).toEqual([]);
  });

  test("a retry not yet due waits", async () => {
    const sent: Sent = arrange({
      pending: [
        rowOf({ attempts: 1, nextAttemptAt: new Date(Date.now() + 60000) }),
      ],
    });

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).not.toHaveBeenCalled();
    expect(sent.updates).toEqual([]);
  });

  test("the mail service refusing is tried again, then given up on", async () => {
    const sent: Sent = arrange({ pending: [rowOf()] });
    sent.emails.mockResolvedValue(
      new HTTPErrorResponse(500, {}, {}) as never,
    );

    await OpenStackProjectNoticeSender.sendWhatIsDue();
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Pending);
    expect(sent.updates[0]!.data.nextAttemptAt).toBeDefined();

    const last: Sent = arrange({ pending: [rowOf({ attempts: 2 })] });
    last.emails.mockResolvedValue(new HTTPErrorResponse(500, {}, {}) as never);

    await OpenStackProjectNoticeSender.sendWhatIsDue();
    expect(lastStatus(last)).toBe(OpenStackProjectNoticeDeliveryStatus.Failed);
  });

  test("an email that may or may not have gone is not sent again", async () => {
    const sent: Sent = arrange({ pending: [rowOf()] });
    sent.emails.mockRejectedValue(new Error("socket hang up"));

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Failed);
  });

  test.each<[number, OpenStackProjectNoticeDeliveryStatus]>([
    [500, OpenStackProjectNoticeDeliveryStatus.Pending],
    [503, OpenStackProjectNoticeDeliveryStatus.Pending],
    [429, OpenStackProjectNoticeDeliveryStatus.Pending],
    [400, OpenStackProjectNoticeDeliveryStatus.Failed],
    [404, OpenStackProjectNoticeDeliveryStatus.Failed],
    [301, OpenStackProjectNoticeDeliveryStatus.Failed],
  ])("a webhook answering %d", async (status, expected) => {
    const sent: Sent = arrange({ pending: [rowOf()], notice: webhookNotice() });
    sent.webhooks.mockResolvedValue(
      new HTTPErrorResponse(status, {}, {}) as never,
    );

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(lastStatus(sent)).toBe(expected);
  });

  test("a webhook that timed out may have been read, so it isn't sent again", async () => {
    const sent: Sent = arrange({ pending: [rowOf()], notice: webhookNotice() });
    sent.webhooks.mockRejectedValue(new Error("timeout"));

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Failed);
  });

  test("a webhook this server may not reach is never asked", async () => {
    const sent: Sent = arrange({ pending: [rowOf()], notice: webhookNotice() });
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockRejectedValue(new Error("not allowed"));

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.webhooks).not.toHaveBeenCalled();
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Failed);
  });

  test("a blocked project's webhook is not sent", async () => {
    const sent: Sent = arrange({ pending: [rowOf()], notice: webhookNotice() });
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(true);

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.webhooks).not.toHaveBeenCalled();
    expect(lastStatus(sent)).toBe(OpenStackProjectNoticeDeliveryStatus.Failed);
  });

  test("one recipient failing costs the others nothing", async () => {
    const otherNotice: ObjectID = ObjectID.generate();
    const sent: Sent = arrange({
      pending: [rowOf(), rowOf({ openStackProjectNoticeId: otherNotice })],
    });
    sent.emails
      .mockRejectedValueOnce(new Error("no") as never)
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);

    await OpenStackProjectNoticeSender.sendWhatIsDue();

    expect(sent.emails).toHaveBeenCalledTimes(2);
    expect(
      sent.updates
        .map((update: { data: Partial<Row> }) => {
          return update.data.status;
        })
        .sort(),
    ).toEqual([
      OpenStackProjectNoticeDeliveryStatus.Failed,
      OpenStackProjectNoticeDeliveryStatus.Sent,
    ]);
  });
});

describe("what is over", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  let open: Array<Row>;
  let lastTold: Row | null;
  let lastClosing: Row | null;
  let closed: Array<string>;
  let recorded: Array<OpenStackProjectNoticeDeliveryToRecord>;

  function incidentWithState(id: ObjectID, isResolved: boolean): Incident {
    const incident: Incident = new Incident();
    incident._id = id.toString();
    const state: IncidentState = new IncidentState();
    state.isResolvedState = isResolved;
    incident.currentIncidentState = state;
    return incident;
  }

  beforeEach(() => {
    open = [];
    lastTold = null;
    lastClosing = null;
    closed = [];
    recorded = [];

    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "findBy")
      .mockImplementation((async () => {
        return open;
      }) as never);
    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "findOneBy")
      .mockImplementation((async (args: { query: { status?: unknown } }) => {
        return args.query.status === OpenStackProjectNoticeDeliveryStatus.Sent
          ? lastTold
          : lastClosing;
      }) as never);
    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "updateOneById")
      .mockImplementation((async (args: { id: ObjectID }) => {
        closed.push(args.id.toString());
      }) as never);
    jest
      .spyOn(OpenStackProjectNoticeDeliveryService, "recordIfNew")
      .mockImplementation((async (
        rows: ReadonlyArray<OpenStackProjectNoticeDeliveryToRecord>,
      ) => {
        recorded.push(...rows);
        return rows.length;
      }) as never);
  });

  test("resolved: whoever was told it opened is told it is over, once", async () => {
    const row: Row = rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent });
    open = [row];
    lastTold = rowOf({
      status: OpenStackProjectNoticeDeliveryStatus.Sent,
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
    });
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incidentWithState(INCIDENT_ID, true)]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toEqual([row._id]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.event).toBe(
      OpenStackProjectNoticeEvent.IncidentResolved,
    );
    expect(recorded[0]!.dedupeKey).toBe(`${lastTold.dedupeKey}:closed`);
    expect((recorded[0]!.facts as JSONObject)["event"]).toBe(
      OpenStackProjectNoticeEvent.IncidentResolved,
    );
    // The same words about the same project, and when it ended.
    expect((recorded[0]!.facts as JSONObject)["projectName"]).toBe(
      "ou-payments",
    );
  });

  test("still open: nothing happens", async () => {
    open = [rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent })];
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incidentWithState(INCIDENT_ID, false)]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test("never told it began: never told it ended", async () => {
    open = [rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Skipped })];
    lastTold = null;
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incidentWithState(INCIDENT_ID, true)]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toHaveLength(1);
    expect(recorded).toEqual([]);
  });

  test("a second incident on the part still holds it: nothing is said yet", async () => {
    const second: ObjectID = ObjectID.generate();
    open = [
      rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent }),
      rowOf({
        status: OpenStackProjectNoticeDeliveryStatus.Skipped,
        incidentId: second,
        dedupeKey: `incident:${second.toString()}:opened`,
      }),
    ];
    lastTold = rowOf({ createdAt: new Date("2026-11-05T10:00:00.000Z") });
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([
        incidentWithState(INCIDENT_ID, true),
        incidentWithState(second, false),
      ]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toHaveLength(1);
    expect(recorded).toEqual([]);
  });

  test("the last incident holding it ends: it is said once, though the first told", async () => {
    const second: ObjectID = ObjectID.generate();
    open = [
      rowOf({
        status: OpenStackProjectNoticeDeliveryStatus.Skipped,
        incidentId: second,
        dedupeKey: `incident:${second.toString()}:opened`,
      }),
    ];
    lastTold = rowOf({ createdAt: new Date("2026-11-05T10:00:00.000Z") });
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incidentWithState(second, true)]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.dedupeKey).toBe(`${lastTold.dedupeKey}:closed`);
  });

  test("already said it was over since it was last told: not said again", async () => {
    open = [rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent })];
    lastTold = rowOf({ createdAt: new Date("2026-11-05T10:00:00.000Z") });
    lastClosing = rowOf({ createdAt: new Date("2026-11-05T11:00:00.000Z") });
    jest
      .spyOn(IncidentService, "findBy")
      .mockResolvedValue([incidentWithState(INCIDENT_ID, true)]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(recorded).toEqual([]);
  });

  test("an incident someone deleted is over too", async () => {
    open = [rowOf({ status: OpenStackProjectNoticeDeliveryStatus.Sent })];
    lastTold = rowOf({ createdAt: new Date("2026-11-05T10:00:00.000Z") });
    jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toHaveLength(1);
    expect(recorded).toHaveLength(1);
  });

  test("maintenance ending says so, by its own word", async () => {
    const eventId: ObjectID = ObjectID.generate();
    open = [
      rowOf({
        status: OpenStackProjectNoticeDeliveryStatus.Sent,
        event: OpenStackProjectNoticeEvent.MaintenancePlanned,
        incidentId: undefined,
        scheduledMaintenanceId: eventId,
        partKey: `maintenance:${eventId.toString()}`,
        dedupeKey: `maintenance:${eventId.toString()}:planned`,
      }),
    ];
    lastTold = rowOf({
      createdAt: new Date("2026-11-05T10:00:00.000Z"),
      dedupeKey: `maintenance:${eventId.toString()}:planned`,
    });

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = eventId.toString();
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.isEndedState = true;
    event.currentScheduledMaintenanceState = state;
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([event]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(recorded).toHaveLength(1);
    expect(recorded[0]!.event).toBe(
      OpenStackProjectNoticeEvent.MaintenanceEnded,
    );
  });

  test("maintenance still on: nothing", async () => {
    const eventId: ObjectID = ObjectID.generate();
    open = [
      rowOf({
        event: OpenStackProjectNoticeEvent.MaintenancePlanned,
        incidentId: undefined,
        scheduledMaintenanceId: eventId,
      }),
    ];

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = eventId.toString();
    const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
    state.isOngoingState = true;
    event.currentScheduledMaintenanceState = state;
    jest
      .spyOn(ScheduledMaintenanceService, "findBy")
      .mockResolvedValue([event]);

    await OpenStackProjectNoticeSender.closeWhatIsOver();

    expect(closed).toEqual([]);
    expect(recorded).toEqual([]);
  });
});
