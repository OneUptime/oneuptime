import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";
import Entities from "../../../Models/DatabaseModels/Index";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackProjectNoticeDelivery from "../../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import MailService from "../../../Server/Services/MailService";
import MonitorService from "../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import OpenStackProjectNoticeDeliveryService from "../../../Server/Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "../../../Server/Services/OpenStackProjectNoticeService";
import OpenStackResourceService, {
  ParsedOpenStackResource,
} from "../../../Server/Services/OpenStackResourceService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import StatusPageAnnouncementService from "../../../Server/Services/StatusPageAnnouncementService";
import logger from "../../../Server/Utils/Logger";
import OpenStackAlertContext, {
  OpenStackSeriesDescription,
} from "../../../Server/Utils/OpenStack/OpenStackAlertContext";
import OpenStackMaintenanceParts from "../../../Server/Utils/OpenStack/OpenStackMaintenanceParts";
import OpenStackMaintenanceReach from "../../../Server/Utils/OpenStack/OpenStackMaintenanceReach";
import OpenStackProjectNoticeSender from "../../../Server/Utils/OpenStack/OpenStackProjectNoticeSender";
import OpenStackProjectNotices from "../../../Server/Utils/OpenStack/OpenStackProjectNotices";
import SSRFProtection from "../../../Server/Utils/SSRFProtection";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { OpenStackBlastRadius } from "../../../Types/OpenStack/OpenStackBlastRadius";
import { OpenStackMaintenancePartKind } from "../../../Types/OpenStack/OpenStackMaintenancePart";
import {
  OpenStackProjectNoticeDecision,
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
  OpenStackProjectNotToldReason,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackStatusPageService } from "../../../Types/OpenStack/OpenStackStatusPageService";
import API from "../../../Utils/API";

/*
 * WHO IS TOLD, FROM THE ROWS, ON POSTGRES.
 *
 * What only a real database can show: the series' labels finding the part, the part's real blast radius,
 * who that tells with several projects on and off, that a row is unique per notice and what it told of
 * however often it is asked, and that only one worker takes a row. Opt in as
 * OpenStackResourcePostgres.test.ts does (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and
 * OPENSTACK_INVENTORY_TEST_DATABASE_*), against a database with the migrations applied. It works on a
 * structure-only clone in a schema of its own, dropped afterwards.
 *
 * Mail and webhooks are stood in for, and what they were asked to send is what is checked.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "OpenStackResource",
  "OpenStackCloud",
  "OpenStackProjectNotice",
  "OpenStackProjectNoticeDelivery",
  "Incident",
  "IncidentState",
  "ScheduledMaintenance",
  "ScheduledMaintenanceState",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const CLOUD_ID: ObjectID = ObjectID.generate();
const OTHER_CLOUD_ID: ObjectID = ObjectID.generate();
const SEEN: Date = new Date();

const PAYMENTS: string = "aaaa0000000000000000000000000001";
const RESEARCH: string = "aaaa0000000000000000000000000002";
const WEB: string = "aaaa0000000000000000000000000003";
const DELETED: string = "aaaa0000000000000000000000000004";

function resource(
  overrides: Partial<ParsedOpenStackResource> & {
    kind: OpenStackResourceKind;
    externalId: string;
  },
): ParsedOpenStackResource {
  return {
    name: null,
    regionName: "RegionOne",
    availabilityZone: null,
    hypervisorName: null,
    openStackProjectId: null,
    status: null,
    adminState: null,
    disabledReason: null,
    vcpuCapacity: null,
    vcpuAllocated: null,
    memoryCapacityBytes: null,
    memoryAllocatedBytes: null,
    diskCapacityBytes: null,
    diskAllocatedBytes: null,
    instanceCount: null,
    facts: {},
    lastSeenAt: SEEN,
    ...overrides,
  };
}

const HOST: string = "compute-01.example.internal";

function instance(
  id: string,
  projectId: string | null,
): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Instance,
    externalId: id,
    name: `vm-${id}`,
    hypervisorName: HOST,
    availabilityZone: "az-east",
    openStackProjectId: projectId,
  });
}

function project(id: string, name: string): ParsedOpenStackResource {
  return resource({
    kind: OpenStackResourceKind.Project,
    externalId: id,
    name,
    regionName: null,
  });
}

const LABELS: JSONObject = {
  "openstack.region.name": "RegionOne",
  hostname: "compute-01",
  service: "nova-compute",
};

describePostgres("who an OpenStack failure tells, on Postgres", () => {
  const schema: string = `openstack_notice_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;
  let emails: ReturnType<typeof jest.spyOn>;
  let webhooks: ReturnType<typeof jest.spyOn>;
  let incidentStateOpen: string;
  let incidentStateResolved: string;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},pg_catalog,public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(logger, "warn").mockReturnValue(undefined as never);
    // A webhook's address needs no DNS to be told about here: what a refusal does is in the sender's own test.
    jest
      .spyOn(SSRFProtection, "validateWebhookTargetIsSafe")
      .mockResolvedValue(undefined);

    incidentStateOpen = ObjectID.generate().toString();
    incidentStateResolved = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "IncidentState" ("_id", "projectId", "name", "slug", "description", "color", "isCreatedState", "isResolvedState", "order", "version")
       VALUES ($1, $3, 'Created', 'created', 'x', '#000000', true, false, 1, 1),
              ($2, $3, 'Resolved', 'resolved', 'x', '#000000', false, true, 2, 1)`,
      [incidentStateOpen, incidentStateResolved, PROJECT_ID.toString()],
    );

    const cloud: OpenStackCloud = new OpenStackCloud();
    cloud._id = CLOUD_ID.toString();
    await database.query(
      `INSERT INTO "OpenStackCloud" ("_id", "projectId", "name", "slug", "version")
       VALUES ($1, $3, 'devstack', 'devstack', 1), ($2, $3, 'other', 'other', 1)`,
      [CLOUD_ID.toString(), OTHER_CLOUD_ID.toString(), PROJECT_ID.toString()],
    );
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(async () => {
    for (const table of [
      "OpenStackResource",
      "OpenStackProjectNotice",
      "OpenStackProjectNoticeDelivery",
      "Incident",
    ]) {
      await database.query(`DELETE FROM "${schema}"."${table}"`);
    }

    await OpenStackResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      resources: [
        resource({
          kind: OpenStackResourceKind.Hypervisor,
          externalId: `RegionOne/${HOST}`,
          name: HOST,
          hypervisorName: HOST,
          availabilityZone: "az-east",
        }),
        resource({
          kind: OpenStackResourceKind.Service,
          externalId: "RegionOne/compute/compute-01/nova-compute",
          name: "nova-compute",
          facts: { host: "compute-01" },
        }),
        project(PAYMENTS, "ou-payments"),
        project(RESEARCH, "ou-research"),
        project(WEB, "ou-web"),
        // DELETED has no project row: Keystone deleted it, and its instance stayed behind.
        instance("i-1", PAYMENTS),
        instance("i-2", PAYMENTS),
        instance("i-3", PAYMENTS),
        instance("i-4", RESEARCH),
        instance("i-5", WEB),
        instance("i-6", WEB),
        instance("i-7", DELETED),
        instance("i-8", null),
      ],
    } as never);

    emails = jest
      .spyOn(MailService, "sendMail")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
    webhooks = jest
      .spyOn(API, "post")
      .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    emails.mockRestore();
    webhooks.mockRestore();
  });

  async function noticeFor(data: {
    openStackProjectId: string;
    email?: string;
    webhook?: string;
    isOn?: boolean;
    cloudId?: ObjectID;
  }): Promise<OpenStackProjectNotice> {
    const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
    notice.projectId = PROJECT_ID;
    notice.openStackCloudId = data.cloudId || CLOUD_ID;
    notice.openStackProjectId = data.openStackProjectId;
    if (data.email) {
      notice.email = new Email(data.email);
    }
    if (data.webhook) {
      notice.webhookUrl = URL.fromString(data.webhook);
    }

    const created: OpenStackProjectNotice =
      await OpenStackProjectNoticeService.create({
        data: notice,
        props: { isRoot: true },
      });

    if (data.isOn !== false) {
      await OpenStackProjectNoticeService.updateOneById({
        id: created.id!,
        data: {
          isEnabled: true,
          previewSeenAt: SEEN,
          previewedRecipient: data.email
            ? `email:${data.email.toLowerCase()}`
            : `webhook:${URL.fromString(data.webhook!).toString()}`,
        },
        props: { isRoot: true },
      });
    }

    return created;
  }

  async function incident(): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();
    await database.query(
      `INSERT INTO "Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version")
       VALUES ($1::uuid, $2, 't', $1::text, $3, $4, 1)`,
      [
        id.toString(),
        PROJECT_ID.toString(),
        incidentStateOpen,
        ObjectID.generate().toString(),
      ],
    );
    return id;
  }

  async function resolve(id: ObjectID): Promise<void> {
    await database.query(
      `UPDATE "Incident" SET "currentIncidentStateId" = $2 WHERE "_id" = $1`,
      [id.toString(), incidentStateResolved],
    );
  }

  // The real path from a series to what is written down, as MonitorIncident takes it.
  async function failureOfTheHost(incidentId: ObjectID): Promise<void> {
    const cloud: OpenStackCloud = new OpenStackCloud();
    cloud._id = CLOUD_ID.toString();
    cloud.id = CLOUD_ID;

    const series: OpenStackSeriesDescription =
      await OpenStackAlertContext.describeSeries({
        description: "A compute host stopped.",
        projectId: PROJECT_ID,
        clouds: [cloud],
        seriesLabels: LABELS,
      });

    await OpenStackProjectNotices.recordForIncident({
      projectId: PROJECT_ID,
      incidentId,
      series,
    });
  }

  async function deliveries(): Promise<Array<OpenStackProjectNoticeDelivery>> {
    return await OpenStackProjectNoticeDeliveryService.findBy({
      query: { projectId: PROJECT_ID },
      select: {
        _id: true,
        openStackProjectId: true,
        openStackProjectNoticeId: true,
        event: true,
        status: true,
        statusMessage: true,
        facts: true,
      },
      skip: 0,
      limit: 2000,
      props: { isRoot: true },
    });
  }

  function emailedTo(): Array<string> {
    return (emails.mock.calls as Array<Array<{ toEmail: Email }>>)
      .map((call: Array<{ toEmail: Email }>): string => {
        return call[0]!.toEmail.toString();
      })
      .sort();
  }

  test("the host's real radius names who is on it, and counts what is no one's", async () => {
    const radius: OpenStackBlastRadius =
      await OpenStackResourceService.getBlastRadius({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        part: {
          kind: OpenStackResourceKind.Service,
          name: "nova-compute",
          regionName: "RegionOne",
          facts: { host: "compute-01" },
        },
        includeEveryProject: true,
      });

    expect(radius.instanceCount).toBe(8);
    expect(radius.projectCount).toBe(4);
    expect(
      radius.everyProject?.find((one: { projectId: string }): boolean => {
        return one.projectId === PAYMENTS;
      })?.instanceCount,
    ).toBe(3);
  });

  test("with several projects on and off, only those turned on are told, each its own", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    await noticeFor({
      openStackProjectId: RESEARCH,
      email: "research@example.com",
      isOn: false,
    });
    await noticeFor({
      openStackProjectId: WEB,
      webhook: "https://web.example.com/hook",
    });

    await failureOfTheHost(await incident());
    await OpenStackProjectNoticeSender.run();

    expect(emailedTo()).toEqual(["payments@example.com"]);
    expect(webhooks).toHaveBeenCalledTimes(1);

    const email: { subject: string; vars: { message: string } } = (
      emails.mock.calls[0] as Array<never>
    )[0]!;
    expect(email.subject).toContain("ou-payments");
    expect(email.vars.message).toContain("3 instances");
    // Nobody else's, and no machine's name.
    for (const word of ["ou-research", "ou-web", "compute-01", RESEARCH, WEB]) {
      expect(email.vars.message).not.toContain(word);
      expect(email.subject).not.toContain(word);
    }

    const hook: { data: JSONObject } = (
      webhooks.mock.calls[0] as Array<never>
    )[0]!;
    expect(hook.data["holdings"]).toEqual({ instanceCount: 2 });
    expect(JSON.stringify(hook.data)).not.toContain("ou-payments");
    expect(JSON.stringify(hook.data)).not.toContain("compute-01");
  });

  test("the feed says who was and wasn't told, by the same answer", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    await noticeFor({
      openStackProjectId: RESEARCH,
      email: "research@example.com",
      isOn: false,
    });
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
    feed.mockClear();

    await failureOfTheHost(await incident());

    expect(feed).toHaveBeenCalledTimes(1);
    const line: string = (
      feed.mock.calls[0] as Array<{ feedInfoInMarkdown: string }>
    )[0]!.feedInfoInMarkdown;
    expect(line).toContain("ou-payments");
    expect(line).toContain(OpenStackProjectNotToldReason.NoticesOff);
  });

  test("a project that was deleted tells nobody, though its instance is still on the host", async () => {
    await noticeFor({ openStackProjectId: DELETED, email: "gone@example.com" });

    const decision: OpenStackProjectNoticeDecision =
      await OpenStackProjectNotices.decide({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        radius: await OpenStackResourceService.getBlastRadius({
          projectId: PROJECT_ID,
          openStackCloudId: CLOUD_ID,
          part: {
            kind: OpenStackResourceKind.Service,
            name: "nova-compute",
            regionName: "RegionOne",
            facts: { host: "compute-01" },
          },
          includeEveryProject: true,
        }),
      });

    expect(decision.told).toEqual([]);
    expect(
      decision.notTold.find((one: { projectId: string }): boolean => {
        return one.projectId === DELETED;
      })?.reason,
    ).toBe(OpenStackProjectNotToldReason.ProjectGone);

    await failureOfTheHost(await incident());
    await OpenStackProjectNoticeSender.run();

    expect(emails).not.toHaveBeenCalled();
    expect(await deliveries()).toEqual([]);
  });

  test("another cloud's notice for a project of the same ID is told nothing", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "other-cloud@example.com",
      cloudId: OTHER_CLOUD_ID,
    });

    await failureOfTheHost(await incident());
    await OpenStackProjectNoticeSender.run();

    expect(emails).not.toHaveBeenCalled();
  });

  test("the same failure written down twice goes out once, and a second run sends nothing", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    const incidentId: ObjectID = await incident();

    await failureOfTheHost(incidentId);
    await failureOfTheHost(incidentId);
    expect(await deliveries()).toHaveLength(1);

    await OpenStackProjectNoticeSender.run();
    await OpenStackProjectNoticeSender.run();

    expect(emails).toHaveBeenCalledTimes(1);
  });

  test("a second incident on a part already told about tells nobody until it is all over", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    const first: ObjectID = await incident();
    const second: ObjectID = await incident();

    await failureOfTheHost(first);
    await OpenStackProjectNoticeSender.run();
    expect(emails).toHaveBeenCalledTimes(1);

    await failureOfTheHost(second);
    await OpenStackProjectNoticeSender.run();
    expect(emails).toHaveBeenCalledTimes(1);

    await resolve(first);
    await OpenStackProjectNoticeSender.run();
    // The part is still held by the second.
    expect(emails).toHaveBeenCalledTimes(1);

    await resolve(second);
    await OpenStackProjectNoticeSender.run();
    expect(emails).toHaveBeenCalledTimes(2);
    expect(
      (emails.mock.calls[1] as Array<{ subject: string }>)[0]!.subject,
    ).toContain("resolved");

    await OpenStackProjectNoticeSender.run();
    expect(emails).toHaveBeenCalledTimes(2);
  });

  test("resolved tells whoever was told it opened, once, and tells nobody who wasn't", async () => {
    const told: OpenStackProjectNotice = await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    await noticeFor({
      openStackProjectId: RESEARCH,
      email: "research@example.com",
      isOn: false,
    });
    const incidentId: ObjectID = await incident();

    await failureOfTheHost(incidentId);
    await OpenStackProjectNoticeSender.run();
    await resolve(incidentId);
    await OpenStackProjectNoticeSender.run();
    await OpenStackProjectNoticeSender.run();

    expect(emailedTo()).toEqual([
      "payments@example.com",
      "payments@example.com",
    ]);

    const rows: Array<OpenStackProjectNoticeDelivery> = await deliveries();
    expect(
      rows
        .map((row: OpenStackProjectNoticeDelivery): string => {
          return `${row.event}|${row.status}|${row.openStackProjectNoticeId?.toString()}`;
        })
        .sort(),
    ).toEqual(
      [
        `${OpenStackProjectNoticeEvent.IncidentOpened}|${OpenStackProjectNoticeDeliveryStatus.Sent}|${told.id!.toString()}`,
        `${OpenStackProjectNoticeEvent.IncidentResolved}|${OpenStackProjectNoticeDeliveryStatus.Sent}|${told.id!.toString()}`,
      ].sort(),
    );
  });

  test("turned off between the failure and the send: nothing goes out, and the row says why", async () => {
    const notice: OpenStackProjectNotice = await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });

    await failureOfTheHost(await incident());
    await OpenStackProjectNoticeService.updateOneById({
      id: notice.id!,
      data: { isEnabled: false },
      props: { isRoot: true },
    });
    await OpenStackProjectNoticeSender.run();

    expect(emails).not.toHaveBeenCalled();
    const rows: Array<OpenStackProjectNoticeDelivery> = await deliveries();
    expect(rows[0]!.status).toBe(OpenStackProjectNoticeDeliveryStatus.Skipped);
    expect(rows[0]!.statusMessage).toContain("turned off");
  });

  test("a recipient changed after its preview is turned off by the change itself", async () => {
    const notice: OpenStackProjectNotice = await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });

    await OpenStackProjectNoticeService.updateOneById({
      id: notice.id!,
      data: { email: new Email("someone-else@example.com") },
      props: { isRoot: true },
    });

    const read: OpenStackProjectNotice | null =
      await OpenStackProjectNoticeService.findOneById({
        id: notice.id!,
        select: {
          isEnabled: true,
          previewSeenAt: true,
          previewedRecipient: true,
        },
        props: { isRoot: true },
      });

    expect(read?.isEnabled).toBe(false);
    expect(read?.previewSeenAt).toBeNull();
    expect(read?.previewedRecipient).toBeNull();

    await failureOfTheHost(await incident());
    await OpenStackProjectNoticeSender.run();

    expect(emails).not.toHaveBeenCalled();
  });

  test("only one worker takes a row, however many ask at once", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    await failureOfTheHost(await incident());

    const row: OpenStackProjectNoticeDelivery = (await deliveries())[0]!;
    const id: ObjectID = new ObjectID(row._id!);
    const claims: Array<boolean> = await Promise.all(
      Array.from({ length: 8 }, () => {
        return OpenStackProjectNoticeDeliveryService.claimForSending(id);
      }),
    );

    expect(
      claims.filter((claim: boolean): boolean => {
        return claim;
      }),
    ).toHaveLength(1);
  });

  test("a part that affects 500 projects tells only the one turned on, past what a description names", async () => {
    const rows: Array<ParsedOpenStackResource> = [];

    for (let index: number = 0; index < 500; index++) {
      const id: string = `bbbb${String(index).padStart(28, "0")}`;
      rows.push(project(id, `tenant-${index}`));
      // More instances for the earlier ones, so the one turned on is past the fifty a description names.
      for (let vm: number = 0; vm < (index < 60 ? 2 : 1); vm++) {
        rows.push(instance(`vm-${index}-${vm}`, id));
      }
    }

    await OpenStackResourceService.bulkUpsert({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      resources: rows,
    } as never);

    const tellThisOne: string = `bbbb${String(450).padStart(28, "0")}`;
    await noticeFor({
      openStackProjectId: tellThisOne,
      email: "tenant@example.com",
    });

    const cloud: OpenStackCloud = new OpenStackCloud();
    cloud._id = CLOUD_ID.toString();
    cloud.id = CLOUD_ID;
    const series: OpenStackSeriesDescription =
      await OpenStackAlertContext.describeSeries({
        description: "A compute host stopped.",
        projectId: PROJECT_ID,
        clouds: [cloud],
        seriesLabels: LABELS,
      });

    expect(series.reached.length).toBeGreaterThan(500);
    // The description stops naming at the cap.
    expect(series.description).not.toContain("tenant-450");

    await OpenStackProjectNotices.recordForIncident({
      projectId: PROJECT_ID,
      incidentId: await incident(),
      series,
    });
    await OpenStackProjectNoticeSender.run();

    expect(emailedTo()).toEqual(["tenant@example.com"]);
    const email: { subject: string; vars: { message: string } } = (
      emails.mock.calls[0] as Array<never>
    )[0]!;
    expect(email.subject).toContain("tenant-450");
    expect(email.vars.message).toContain("1 instance");
    expect(email.vars.message).not.toContain("tenant-1");
  }, 300000);

  test("maintenance on a host names who it reaches, tells who asked once, and says when it ends", async () => {
    await noticeFor({
      openStackProjectId: PAYMENTS,
      email: "payments@example.com",
    });
    await noticeFor({
      openStackProjectId: RESEARCH,
      email: "research@example.com",
      isOn: false,
    });

    const eventId: ObjectID = ObjectID.generate();
    const stateOn: string = ObjectID.generate().toString();
    const stateEnded: string = ObjectID.generate().toString();
    await database.query(
      `INSERT INTO "ScheduledMaintenanceState" ("_id", "projectId", "name", "slug", "description", "color", "isOngoingState", "isEndedState", "order", "version")
       VALUES ($1, $3, 'On', 'on', 'x', '#000000', true, false, 1, 1),
              ($2, $3, 'Ended', 'ended', 'x', '#000000', false, true, 2, 1)`,
      [stateOn, stateEnded, PROJECT_ID.toString()],
    );
    await database.query(
      `INSERT INTO "ScheduledMaintenance" ("_id", "projectId", "title", "slug", "currentScheduledMaintenanceStateId", "startsAt", "endsAt", "version")
       VALUES ($1, $2, 't', 't', $3, now(), now(), 1)`,
      [eventId.toString(), PROJECT_ID.toString(), stateOn],
    );

    const parts: Array<JSONObject> = [
      {
        openStackCloudId: CLOUD_ID.toString(),
        kind: OpenStackMaintenancePartKind.Hypervisor,
        name: HOST,
        regionName: "RegionOne",
      },
    ];
    const feed: ReturnType<typeof jest.spyOn> = jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockResolvedValue(undefined as never);
    feed.mockClear();

    await OpenStackMaintenanceReach.nameInFeed({
      projectId: PROJECT_ID,
      scheduledMaintenanceId: eventId,
      openStackParts: parts,
    });
    const named: string = (
      feed.mock.calls[0] as Array<{ feedInfoInMarkdown: string }>
    )[0]!.feedInfoInMarkdown;
    expect(named).toContain("8 instances in 4 projects");
    expect(named).toContain("ou-payments");

    await OpenStackProjectNotices.recordForMaintenance({
      projectId: PROJECT_ID,
      scheduledMaintenanceId: eventId,
      openStackParts: parts,
      startsAt: new Date("2026-11-07T09:30:00.000Z"),
      endsAt: new Date("2026-11-07T11:00:00.000Z"),
    });
    await OpenStackProjectNoticeSender.run();

    expect(emailedTo()).toEqual(["payments@example.com"]);
    const planned: { subject: string; vars: { message: string } } = (
      emails.mock.calls[0] as Array<never>
    )[0]!;
    expect(planned.subject).toContain("maintenance planned");
    expect(planned.vars.message).toContain("2026-11-07 09:30 UTC");
    expect(planned.vars.message).not.toContain("ou-research");
    expect(planned.vars.message).not.toContain("compute-01");

    await OpenStackProjectNoticeSender.run();
    expect(emails).toHaveBeenCalledTimes(1);

    await database.query(
      `UPDATE "ScheduledMaintenance" SET "currentScheduledMaintenanceStateId" = $2 WHERE "_id" = $1`,
      [eventId.toString(), stateEnded],
    );
    await OpenStackProjectNoticeSender.run();
    await OpenStackProjectNoticeSender.run();

    expect(emails).toHaveBeenCalledTimes(2);
    expect(
      (emails.mock.calls[1] as Array<{ subject: string }>)[0]!.subject,
    ).toContain("ended");
  });

  test("a project's own page is told like any notice: its row goes red once, and back when it is over", async () => {
    const pageId: ObjectID = ObjectID.generate();
    const monitorId: ObjectID = ObjectID.generate();
    const otherRow: ObjectID = ObjectID.generate();
    const announcementId: ObjectID = ObjectID.generate();

    const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
    notice.projectId = PROJECT_ID;
    notice.openStackCloudId = CLOUD_ID;
    notice.openStackProjectId = PAYMENTS;
    notice.statusPageRows = [
      {
        regionName: "RegionOne",
        service: OpenStackStatusPageService.Compute,
        monitorId: monitorId.toString(),
      },
      {
        regionName: "RegionOne",
        service: OpenStackStatusPageService.BlockStorage,
        monitorId: otherRow.toString(),
      },
    ];
    // By its id alone: this clone holds no status page for a reference to be checked against.
    await database.query(
      `INSERT INTO "OpenStackProjectNotice" ("_id", "projectId", "openStackCloudId", "openStackProjectId", "statusPageId", "statusPageRows", "isEnabled", "previewSeenAt", "previewedRecipient", "version")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, now(), $7, 1)`,
      [
        ObjectID.generate().toString(),
        PROJECT_ID.toString(),
        CLOUD_ID.toString(),
        PAYMENTS,
        pageId.toString(),
        JSON.stringify(notice.statusPageRows),
        `statusPage:${pageId.toString()}`,
      ],
    );

    const statusOf: Record<string, string> = {};
    const online: MonitorStatus = new MonitorStatus();
    online.id = ObjectID.generate();
    const offline: MonitorStatus = new MonitorStatus();
    offline.id = ObjectID.generate();

    jest
      .spyOn(MonitorStatusService, "findOneBy")
      .mockImplementation((async (args: {
        query: { isOfflineState?: boolean };
      }) => {
        return args.query.isOfflineState ? offline : online;
      }) as never);
    jest.spyOn(MonitorService, "findOneById").mockImplementation((async (args: {
      id: ObjectID;
    }) => {
      const monitor: Monitor = new Monitor();
      monitor.currentMonitorStatusId = new ObjectID(
        statusOf[args.id.toString()] || online.id!.toString(),
      );
      return monitor;
    }) as never);
    const turned: ReturnType<typeof jest.spyOn> = jest
      .spyOn(MonitorStatusTimelineService, "create")
      .mockImplementation((async (args: {
        data: { monitorId: ObjectID; monitorStatusId: ObjectID };
      }) => {
        statusOf[args.data.monitorId.toString()] =
          args.data.monitorStatusId.toString();
      }) as never);
    const announced: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageAnnouncementService, "create")
      .mockImplementation((async () => {
        const announcement: StatusPageAnnouncement =
          new StatusPageAnnouncement();
        announcement.id = announcementId;
        return announcement;
      }) as never);
    const ended: ReturnType<typeof jest.spyOn> = jest
      .spyOn(StatusPageAnnouncementService, "updateOneById")
      .mockResolvedValue(undefined as never);

    const incidentId: ObjectID = await incident();
    await failureOfTheHost(incidentId);
    await OpenStackProjectNoticeSender.run();

    // Told, in its own words, on its own page and nowhere else.
    expect(announced).toHaveBeenCalledTimes(1);
    const made: {
      data: StatusPageAnnouncement;
    } = (announced.mock.calls[0] as Array<never>)[0]!;
    expect(
      made.data.statusPages?.map((page: { _id?: string }) => {
        return page._id;
      }),
    ).toEqual([pageId.toString()]);
    expect(made.data.description).toContain("3 instances");
    for (const word of ["ou-research", "ou-web", "compute-01", RESEARCH, WEB]) {
      expect(made.data.description).not.toContain(word);
      expect(made.data.title).not.toContain(word);
    }

    // Its Compute row is red, and its other row isn't.
    expect(statusOf[monitorId.toString()]).toBe(offline.id!.toString());
    expect(statusOf[otherRow.toString()]).toBeUndefined();
    expect(turned).toHaveBeenCalledTimes(1);

    // However long it lasts.
    await OpenStackProjectNoticeSender.run();
    expect(announced).toHaveBeenCalledTimes(1);
    expect(turned).toHaveBeenCalledTimes(1);

    await resolve(incidentId);
    await OpenStackProjectNoticeSender.run();
    await OpenStackProjectNoticeSender.run();

    expect(ended).toHaveBeenCalledTimes(1);
    expect(
      (ended.mock.calls[0] as Array<{ id: ObjectID }>)[0]!.id.toString(),
    ).toBe(announcementId.toString());
    expect(statusOf[monitorId.toString()]).toBe(online.id!.toString());
    expect(turned).toHaveBeenCalledTimes(2);
    // No email or webhook was anywhere near this.
    expect(emails).not.toHaveBeenCalled();
    expect(webhooks).not.toHaveBeenCalled();
  });

  test("a zone comes to the hosts in it, for what it reaches and what it quiets", async () => {
    const hosts: Array<string> =
      await OpenStackMaintenanceParts.readHostsOfZone({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        zoneName: "az-east",
        regionName: "RegionOne",
      });
    expect(hosts).toEqual([HOST]);

    expect(
      await OpenStackMaintenanceParts.readHostsOfZone({
        projectId: PROJECT_ID,
        openStackCloudId: CLOUD_ID,
        zoneName: "az-east",
        regionName: "RegionTwo",
      }),
    ).toEqual([]);

    const radius: OpenStackBlastRadius = await OpenStackMaintenanceReach.read({
      projectId: PROJECT_ID,
      openStackCloudId: CLOUD_ID,
      parts: [
        {
          openStackCloudId: CLOUD_ID.toString(),
          kind: OpenStackMaintenancePartKind.AvailabilityZone,
          name: "az-east",
          regionName: "RegionOne",
        },
      ],
    });

    expect(radius.instanceCount).toBe(8);
  });
});
