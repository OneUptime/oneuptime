/*
 * The alert and incident creation paths pull the native isolated-vm addon
 * through their template renderer (MonitorAlert / MonitorIncident →
 * MonitorTemplateUtil → VMAPI → VMRunner). Nothing under test here touches
 * the sandbox, and the prebuilt binary cannot always dlopen in the test
 * environment — so stub the module out before anything imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import NetworkDeviceOwnerUserService from "../../../../Server/Services/NetworkDeviceOwnerUserService";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import logger from "../../../../Server/Utils/Logger";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import {
  redactMonitorEmailAddress,
  redactMonitorSecret,
} from "../../../../Server/Utils/Monitor/MonitorPayloadRedaction";
import MonitorResourceContextUtil from "../../../../Server/Utils/Monitor/MonitorResourceContext";
import { MaxEmailValueLengthInTitle } from "../../../../Server/Utils/Monitor/MonitorTemplateUtil";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Dictionary from "../../../../Types/Dictionary";
import IncomingEmailMonitorRequest from "../../../../Types/Monitor/IncomingEmailMonitor/IncomingEmailMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * An Incoming Email monitor's criteria opening an alert or an incident whose
 * title and description quote the email, end to end through MonitorAlert and
 * MonitorIncident.
 *
 * The docs promised {{emailSubject}}, {{emailFrom}}, {{emailTo}},
 * {{emailBody}} and {{emailReceivedAt}}, but the template storage map had no
 * Incoming Email branch, so an alert titled "{{emailSubject}}" was opened
 * with that placeholder as its title, braces and all.
 *
 * The email is shaped the way processIncomingEmailFromQueue hands it to
 * monitorResource: its sender's text untouched, the monitor's own address
 * already masked at the ingest boundary.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_SEVERITY_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const INCIDENT_SEVERITY_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const SECRET_KEY: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const INBOUND_DOMAIN: string = "inbound.oneuptime.example";
const MONITOR_ADDRESS: string = `monitor-${SECRET_KEY}@${INBOUND_DOMAIN}`;
const MASKED_MONITOR_ADDRESS: string = `monitor-${REDACTED}@${INBOUND_DOMAIN}`;

const RECEIVED_AT: Date = new Date("2026-10-05T09:55:00.000Z");

const SUBJECT: string = "[FAILED] Nightly backup of orders-db";
const BODY: string = [
  "The nightly backup of orders-db failed at 09:54 UTC.",
  "",
  "Error: disk quota exceeded on /backups.",
  `Replies to this alert go to ${MONITOR_ADDRESS}.`,
].join("\n");

const CUSTOM_LOCAL_PART: string = "nightly-backups";
const CUSTOM_ADDRESS: string = `${CUSTOM_LOCAL_PART}@${INBOUND_DOMAIN}`;

const MONITOR_CREATED_AT: Date = new Date("2026-10-01T08:00:00.000Z");
const CHECKED_AT: Date = new Date("2026-10-05T11:00:00.000Z");

function monitor(
  options: {
    monitorType?: MonitorType | undefined;
    customLocalPart?: string | undefined;
  } = {},
): Monitor {
  const model: Monitor = new Monitor();
  model._id = MONITOR_ID.toString();
  model.projectId = PROJECT_ID;
  model.monitorType = options.monitorType || MonitorType.IncomingEmail;
  model.name = "Nightly backups";
  // The monitor's credentials are on the model the creators are handed.
  model.incomingEmailSecretKey = new ObjectID(SECRET_KEY);

  if (options.customLocalPart) {
    model.incomingEmailCustomLocalPart = options.customLocalPart;
  }

  return model;
}

type SentFields = Pick<
  IncomingEmailMonitorRequest,
  "emailFrom" | "emailTo" | "emailSubject" | "emailBody"
>;

function receivedEmail(sent: {
  subject: string;
  body: string;
  from?: string | undefined;
  to?: string | undefined;
}): IncomingEmailMonitorRequest {
  const masked: SentFields = redactMonitorSecret(
    {
      emailFrom: sent.from || "backups@acme.example",
      emailTo: sent.to || MONITOR_ADDRESS,
      emailSubject: sent.subject,
      emailBody: sent.body,
    },
    SECRET_KEY,
  );

  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    ...masked,
    emailHeaders: { "Delivered-To": masked.emailTo },
    emailReceivedAt: RECEIVED_AT,
    checkedAt: RECEIVED_AT,
    onlyCheckForIncomingEmailReceivedAt: false,
  };
}

// Mail to the monitor's custom address, masked as the ingest boundary masks it.
function receivedAtCustomAddress(sent: {
  subject: string;
  body: string;
}): IncomingEmailMonitorRequest {
  const masked: SentFields = redactMonitorEmailAddress(
    {
      emailFrom: "nightly-backups@acme.example",
      emailTo: CUSTOM_ADDRESS,
      emailSubject: sent.subject,
      emailBody: sent.body,
    },
    { localPart: CUSTOM_LOCAL_PART, domain: INBOUND_DOMAIN },
  );

  return {
    ...receivedEmail({ subject: sent.subject, body: sent.body }),
    ...masked,
    emailHeaders: { "Delivered-To": masked.emailTo },
  };
}

/*
 * What Workers' IncomingEmailMonitor/CheckOnlineStatus hands monitorResource
 * between emails: the monitor's stored last email (jsonb, so its Date comes
 * back as text), or - before any email arrived - empty fields with the
 * monitor's creation time standing in for emailReceivedAt.
 */
function scheduledCheckAfter(
  lastEmail: IncomingEmailMonitorRequest,
): IncomingEmailMonitorRequest {
  return {
    ...lastEmail,
    emailReceivedAt: lastEmail.emailReceivedAt.toISOString() as unknown as Date,
    checkedAt: CHECKED_AT,
    onlyCheckForIncomingEmailReceivedAt: true,
  };
}

function scheduledCheckBeforeAnyEmail(): IncomingEmailMonitorRequest {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    emailFrom: "",
    emailTo: "",
    emailSubject: "",
    emailBody: "",
    emailReceivedAt: MONITOR_CREATED_AT,
    checkedAt: CHECKED_AT,
    onlyCheckForIncomingEmailReceivedAt: true,
  };
}

interface Template {
  title: string;
  description: string;
  remediationNotes?: string | undefined;
}

function alertCriteria(template: Template): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Backup failed";
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = true;
  instance.data!.alerts = [
    {
      id: "alert-template-1",
      title: template.title,
      description: template.description,
      remediationNotes: template.remediationNotes,
      alertSeverityId: ALERT_SEVERITY_ID,
      autoResolveAlert: false,
    },
  ];
  return instance;
}

function incidentCriteria(template: Template): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Backup failed";
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = false;
  instance.data!.incidents = [
    {
      id: "incident-template-1",
      title: template.title,
      description: template.description,
      remediationNotes: template.remediationNotes,
      incidentSeverityId: INCIDENT_SEVERITY_ID,
      autoResolveIncident: false,
    },
  ];
  return instance;
}

const NO_AUTO_RESOLVE: Dictionary<Array<string>> = {};

/*
 * The creators check the criteria's severity with findOneBy before using it.
 * Answer it with a severity of the monitor's own project.
 */
function registerSeverity(
  service: { findOneBy: unknown },
  severity: DatabaseBaseModel,
  id: ObjectID,
): void {
  severity._id = id.toString();
  severity.setValue("projectId", PROJECT_ID);

  jest
    .spyOn(service as never, "findOneBy" as never)
    .mockImplementation((async (): Promise<DatabaseBaseModel> => {
      return severity;
    }) as never);
}

let createdAlerts: Array<Alert> = [];
let createdIncidents: Array<Incident> = [];

beforeEach(() => {
  createdAlerts = [];
  createdIncidents = [];

  // Nothing is already open for this monitor.
  jest.spyOn(AlertService, "findBy").mockResolvedValue([]);
  jest.spyOn(IncidentService, "findBy").mockResolvedValue([]);

  registerSeverity(
    AlertSeverityService,
    new AlertSeverity(),
    ALERT_SEVERITY_ID,
  );
  registerSeverity(
    IncidentSeverityService,
    new IncidentSeverity(),
    INCIDENT_SEVERITY_ID,
  );

  jest
    .spyOn(MonitorResourceContextUtil, "resolveResourceContextForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());

  jest
    .spyOn(MonitorResourceContextUtil, "resolveLinkedResourcesForMonitor")
    .mockResolvedValue(MonitorResourceContextUtil.emptyContext());

  jest
    .spyOn(NetworkDeviceOwnerUserService, "getDeviceOwnersForMonitor")
    .mockResolvedValue({ ownerUserIds: [], ownerTeamIds: [] });

  jest
    .spyOn(AlertService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Alert> => {
      const alert: Alert = (createBy as { data: Alert }).data;
      createdAlerts.push(alert);
      alert._id = new ObjectID(
        "77777777-7777-4777-8777-777777777777",
      ).toString();
      return alert;
    });

  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (createBy: unknown): Promise<Incident> => {
      const incident: Incident = (createBy as { data: Incident }).data;
      createdIncidents.push(incident);
      incident._id = new ObjectID(
        "66666666-6666-4666-8666-666666666666",
      ).toString();
      return incident;
    });

  jest.spyOn(AlertService, "addOwners").mockResolvedValue(undefined);
  jest.spyOn(IncidentService, "addOwners").mockResolvedValue(undefined);

  jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function openAlert(
  template: Template,
  email: DataToProcess,
  model: Monitor = monitor(),
): Promise<Alert> {
  await MonitorAlert.criteriaMetCreateAlertsAndUpdateMonitorStatus({
    criteriaInstance: alertCriteria(template),
    monitor: model,
    dataToProcess: email,
    rootCause: 'Email subject contains "FAILED".',
    autoResolveCriteriaInstanceIdAlertIdsDictionary: NO_AUTO_RESOLVE,
    props: {},
  });

  expect(createdAlerts).toHaveLength(1);
  return createdAlerts[0]!;
}

async function openIncident(
  template: Template,
  email: DataToProcess,
  model: Monitor = monitor(),
): Promise<Incident> {
  await MonitorIncident.criteriaMetCreateIncidentsAndUpdateMonitorStatus({
    criteriaInstance: incidentCriteria(template),
    monitor: model,
    dataToProcess: email,
    rootCause: 'Email subject contains "FAILED".',
    autoResolveCriteriaInstanceIdIncidentIdsDictionary: NO_AUTO_RESOLVE,
    props: {},
  });

  expect(createdIncidents).toHaveLength(1);
  return createdIncidents[0]!;
}

// The body as the description renders it: the monitor's address masked.
const MASKED_BODY: string = BODY.replace(
  MONITOR_ADDRESS,
  MASKED_MONITOR_ADDRESS,
);

/*
 * Long enough that quoting it whole would overflow the 500-character title
 * column, which create refuses: the alert or incident would not be opened at
 * all, on exactly the emails that say the most.
 */
const LONG_SUBJECT: string = `Disk usage critical on ${Array.from(
  { length: 60 },
  (_: unknown, index: number): string => {
    return `db-${index}.prod`;
  },
).join(", ")}`;

const LONG_BODY: string = Array.from(
  { length: 80 },
  (_: unknown, index: number): string => {
    return `Line ${index}: /data/volume-${index} is at 99% of its quota.`;
  },
).join("\n");

// What a title quotes of a value: one line, cut to the cap, marked as cut.
function cutForTitle(text: string): string {
  const line: string = text.split("\n").join(" ");

  return `${line.slice(0, MaxEmailValueLengthInTitle - "...".length)}...`;
}

describe("An Incoming Email monitor's alert renders the email's template variables", () => {
  it('titles an alert "{{emailSubject}}" with the email\'s subject', async () => {
    const alert: Alert = await openAlert(
      {
        title: "{{emailSubject}}",
        description: "{{emailBody}}",
      },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(alert.title).toBe(SUBJECT);
    expect(alert.description).toBe(MASKED_BODY);
  });

  it("fills every documented variable, in the title, description and remediation notes", async () => {
    const alert: Alert = await openAlert(
      {
        title: "{{emailSubject}} (from {{emailFrom}})",
        description:
          "Sent to {{emailTo}} at {{emailReceivedAt}}.\n\n{{emailBody}}",
        remediationNotes:
          "Reply to {{emailFrom}} once {{emailSubject}} is fixed.",
      },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(alert.title).toBe(`${SUBJECT} (from backups@acme.example)`);
    expect(alert.description).toBe(
      `Sent to ${MASKED_MONITOR_ADDRESS} at 2026-10-05T09:55:00.000Z.\n\n${MASKED_BODY}`,
    );
    expect(alert.remediationNotes).toBe(
      `Reply to backups@acme.example once ${SUBJECT} is fixed.`,
    );
  });

  it("never puts the monitor's address back: it stays masked as the ingest boundary left it", async () => {
    const alert: Alert = await openAlert(
      {
        title: "{{emailTo}}: {{emailSubject}}",
        description: "{{emailTo}}\n\n{{emailBody}}",
        remediationNotes: "{{emailTo}}",
      },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(alert.title).toBe(`${MASKED_MONITOR_ADDRESS}: ${SUBJECT}`);

    for (const text of [
      alert.title,
      alert.description,
      alert.remediationNotes,
    ]) {
      expect(text).not.toContain(SECRET_KEY);
    }
  });

  it("still opens the alert for a long email, with a one-line title that fits its column", async () => {
    const alert: Alert = await openAlert(
      {
        title: "{{emailSubject}}: {{emailBody}}",
        description: "{{emailBody}}",
      },
      receivedEmail({ subject: LONG_SUBJECT, body: LONG_BODY }),
    );

    // Each quoted value is cut to its own bounded line, marked as cut.
    expect(alert.title).toBe(
      `${cutForTitle(LONG_SUBJECT)}: ${cutForTitle(LONG_BODY)}`,
    );
    expect(alert.title!.length).toBeLessThanOrEqual(ColumnLength.LongText);

    // The description is not a title: it quotes the body in full.
    expect(alert.description).toBe(LONG_BODY);
  });

  it("keeps a monitor's custom address masked, and the sender's address that shares its name", async () => {
    const alert: Alert = await openAlert(
      {
        title: "{{emailTo}} from {{emailFrom}}",
        description: "{{emailTo}}\n\n{{emailBody}}",
      },
      receivedAtCustomAddress({
        subject: SUBJECT,
        body: `Replies go to ${CUSTOM_ADDRESS}.`,
      }),
      monitor({ customLocalPart: CUSTOM_LOCAL_PART }),
    );

    expect(alert.title).toBe(
      `${REDACTED}@${INBOUND_DOMAIN} from nightly-backups@acme.example`,
    );
    expect(alert.description).toBe(
      `${REDACTED}@${INBOUND_DOMAIN}\n\nReplies go to ${REDACTED}@${INBOUND_DOMAIN}.`,
    );
    expect(`${alert.title}${alert.description}`).not.toContain(CUSTOM_ADDRESS);
  });

  it("puts a subject with a line break on one line in the title, and keeps it in the description", async () => {
    // An RFC 2047 encoded-word can decode to a line break.
    const alert: Alert = await openAlert(
      {
        title: "{{emailSubject}}",
        description: "{{emailSubject}}",
      },
      receivedEmail({ subject: "Backup failed\r\non orders-db", body: BODY }),
    );

    expect(alert.title).toBe("Backup failed on orders-db");
    expect(alert.description).toBe("Backup failed\r\non orders-db");
  });

  it("keeps an emoji subject intact", async () => {
    const alert: Alert = await openAlert(
      { title: "{{emailSubject}}", description: "{{emailBody}}" },
      receivedEmail({ subject: "🚨 [FIRING:1] Disk full 💾", body: BODY }),
    );

    expect(alert.title).toBe("🚨 [FIRING:1] Disk full 💾");
  });

  it("leaves a title that uses no email variable as it was written", async () => {
    const alert: Alert = await openAlert(
      { title: "Backup failed", description: "{{emailSubject}}" },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(alert.title).toBe("Backup failed");
    expect(alert.description).toBe(SUBJECT);
  });

  it("fits the title column with the monitor's name and three long email values", async () => {
    const alert: Alert = await openAlert(
      {
        title:
          "{{monitorName}}: {{emailSubject}} from {{emailFrom}} to {{emailTo}}",
        description: "{{emailBody}}",
      },
      receivedEmail({
        subject: LONG_SUBJECT,
        body: LONG_BODY,
        from: `"${"Very Long Display Name ".repeat(20)}" <alerts@acme.example>`,
        to: Array.from({ length: 40 }, (_: unknown, index: number): string => {
          return `oncall-${index}@acme.example`;
        }).join(", "),
      }),
    );

    expect(
      alert.title!.startsWith("Nightly backups: Disk usage critical"),
    ).toBe(true);
    expect(alert.title!.length).toBeLessThanOrEqual(ColumnLength.LongText);
  });

  it("on a scheduled check, quotes the last email the monitor received", async () => {
    const alert: Alert = await openAlert(
      {
        title: "No email since {{emailReceivedAt}} (last: {{emailSubject}})",
        description: "Last email from {{emailFrom}}:\n\n{{emailBody}}",
      },
      scheduledCheckAfter(receivedEmail({ subject: SUBJECT, body: BODY })),
    );

    expect(alert.title).toBe(
      `No email since 2026-10-05T09:55:00.000Z (last: ${SUBJECT})`,
    );
    expect(alert.description).toBe(
      `Last email from backups@acme.example:\n\n${MASKED_BODY}`,
    );
  });

  it("on a scheduled check before any email, leaves no placeholder and no made-up time", async () => {
    const alert: Alert = await openAlert(
      {
        title: "No email yet [{{emailReceivedAt}}] {{emailSubject}}",
        description: "From: {{emailFrom}} To: {{emailTo}} Body: {{emailBody}}",
      },
      scheduledCheckBeforeAnyEmail(),
    );

    expect(alert.title).toBe("No email yet [] ");
    expect(alert.description).toBe("From:  To:  Body: ");
    // The stand-in is the monitor's creation time, not an email's.
    expect(alert.title).not.toContain("2026-10-01");
  });
});

describe("Other monitor types' titles render as they did", () => {
  it("does not shape a Website monitor's response body in its title", async () => {
    const response: ProbeMonitorResponse = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      monitoredAt: RECEIVED_AT,
      isOnline: false,
      responseCode: 503,
      responseBody: "<h1>Down</h1>\n<p>Maintenance</p>",
    } as unknown as ProbeMonitorResponse;

    const alert: Alert = await openAlert(
      { title: "{{responseBody}}", description: "{{responseStatusCode}}" },
      response,
      monitor({ monitorType: MonitorType.Website }),
    );

    expect(alert.title).toBe("<h1>Down</h1>\n<p>Maintenance</p>");
    expect(alert.description).toBe("503");
  });
});

describe("An Incoming Email monitor's incident renders the email's template variables", () => {
  it('titles an incident "{{emailSubject}}" with the email\'s subject', async () => {
    const incident: Incident = await openIncident(
      {
        title: "{{emailSubject}}",
        description: "{{emailBody}}",
      },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(incident.title).toBe(SUBJECT);
    expect(incident.description).toBe(MASKED_BODY);
  });

  it("still opens the incident for a long email, with a one-line title that fits its column", async () => {
    const incident: Incident = await openIncident(
      {
        title: "[Email] {{emailSubject}} - {{emailBody}}",
        description: "{{emailSubject}}\n\n{{emailBody}}",
        remediationNotes: "{{emailBody}}",
      },
      receivedEmail({ subject: LONG_SUBJECT, body: LONG_BODY }),
    );

    expect(incident.title).toBe(
      `[Email] ${cutForTitle(LONG_SUBJECT)} - ${cutForTitle(LONG_BODY)}`,
    );
    expect(incident.title!.length).toBeLessThanOrEqual(ColumnLength.LongText);
    expect(incident.description).toBe(`${LONG_SUBJECT}\n\n${LONG_BODY}`);
    expect(incident.remediationNotes).toBe(LONG_BODY);
  });

  it("never puts the monitor's address back into an incident", async () => {
    const incident: Incident = await openIncident(
      {
        title: "{{emailTo}}: {{emailSubject}}",
        description: "{{emailTo}}\n\n{{emailBody}}",
        remediationNotes: "Check {{emailTo}}",
      },
      receivedEmail({ subject: SUBJECT, body: BODY }),
    );

    expect(incident.title).toBe(`${MASKED_MONITOR_ADDRESS}: ${SUBJECT}`);
    expect(incident.remediationNotes).toBe(`Check ${MASKED_MONITOR_ADDRESS}`);

    for (const text of [
      incident.title,
      incident.description,
      incident.remediationNotes,
    ]) {
      expect(text).not.toContain(SECRET_KEY);
    }
  });

  it("on a scheduled check, quotes the last email the monitor received", async () => {
    const incident: Incident = await openIncident(
      {
        title: "No email since {{emailReceivedAt}}",
        description: "Last email: {{emailSubject}}",
      },
      scheduledCheckAfter(receivedEmail({ subject: SUBJECT, body: BODY })),
    );

    expect(incident.title).toBe("No email since 2026-10-05T09:55:00.000Z");
    expect(incident.description).toBe(`Last email: ${SUBJECT}`);
  });

  it("on a scheduled check before any email, leaves no placeholder", async () => {
    const incident: Incident = await openIncident(
      {
        title: "No email received{{emailSubject}}",
        description: "Last email received at: {{emailReceivedAt}}",
      },
      scheduledCheckBeforeAnyEmail(),
    );

    expect(incident.title).toBe("No email received");
    expect(incident.description).toBe("Last email received at: ");
  });
});
