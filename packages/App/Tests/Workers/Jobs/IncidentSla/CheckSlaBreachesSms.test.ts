import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import IncidentSlaRule from "Common/Models/DatabaseModels/IncidentSlaRule";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import IncidentSlaStatus from "Common/Types/Incident/IncidentSlaStatus";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import { WhatsAppTemplateIds } from "Common/Types/WhatsApp/WhatsAppTemplates";
import {
  buildNotificationSms,
  NOTIFICATION_SMS_TURN_OFF,
} from "Common/Utils/Sms/NotificationSms";

/*
 * WHAT AN SLA BREACH TELLS THE INCIDENT'S OWNERS, through one tick of the
 * real CheckSlaBreaches job: an SLA whose deadline has passed.
 *
 * The notice used to borrow the "incident created" event, email and
 * WhatsApp template - its email said "A new incident has been created", and
 * switching "Incident created" off silenced breaches too. It goes out under
 * "Incident SLA breached" now (IncidentSlaBreachNotice words it), and says
 * which deadline was missed on every channel. Its SMS says the news the way
 * every notification SMS does (Utils/Sms/NotificationSms).
 *
 * The job registers itself through RunCron at import time and exports
 * nothing, so the Cron util is mocked to capture the handler (as the other
 * App/Tests/Workers/Jobs suites do), and every service it calls is replaced
 * with the methods it calls.
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
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentSlaService", () => {
  return {
    __esModule: true,
    default: {
      getSlasNeedingBreachCheck: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/IncidentService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      findOwners: jest.fn(),
      getIncidentLinkInDashboard: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      getOwners: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserNotificationSettingService", () => {
  return {
    __esModule: true,
    default: {
      sendUserNotification: jest.fn(),
      addIncidentSlaBreachedNotificationSettings: jest.fn(),
    },
  };
});

import IncidentSlaService from "Common/Server/Services/IncidentSlaService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";

import "../../../../FeatureSet/Workers/Jobs/IncidentSla/CheckSlaBreaches";

const PROJECT_ID: ObjectID = new ObjectID(
  "5114d000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "5114d000-0000-4000-8000-000000000002",
);
const SLA_ID: ObjectID = new ObjectID("5114d000-0000-4000-8000-000000000003");
const OWNER_ID: ObjectID = new ObjectID("5114d000-0000-4000-8000-000000000004");
const PROJECT_OWNER_ID: ObjectID = new ObjectID(
  "5114d000-0000-4000-8000-000000000006",
);

interface SentNotification {
  userId: ObjectID;
  projectId: ObjectID;
  incidentId: ObjectID;
  eventType: NotificationSettingEventType;
  emailEnvelope: EmailEnvelope;
  smsMessage: SMSMessage;
  whatsAppMessage: WhatsAppMessagePayload;
  forceImmediate?: boolean;
}

const slaService: { getSlasNeedingBreachCheck: jest.Mock } =
  IncidentSlaService as unknown as { getSlasNeedingBreachCheck: jest.Mock };
const incidentService: {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getIncidentLinkInDashboard: jest.Mock;
} = IncidentService as unknown as {
  findOneById: jest.Mock;
  findOwners: jest.Mock;
  getIncidentLinkInDashboard: jest.Mock;
};
const projectService: { getOwners: jest.Mock } = ProjectService as unknown as {
  getOwners: jest.Mock;
};
const notificationService: {
  sendUserNotification: jest.Mock;
  addIncidentSlaBreachedNotificationSettings: jest.Mock;
} = UserNotificationSettingService as unknown as {
  sendUserNotification: jest.Mock;
  addIncidentSlaBreachedNotificationSettings: jest.Mock;
};

let deadline: Date;
let callOrder: Array<string>;

const breachedSla: (breach?: "response" | "resolution") => IncidentSla = (
  breach?: "response" | "resolution",
): IncidentSla => {
  const sla: IncidentSla = new IncidentSla();
  sla.id = SLA_ID;
  sla.projectId = PROJECT_ID;
  sla.incidentId = INCIDENT_ID;
  sla.status = IncidentSlaStatus.OnTrack;
  sla.slaStartedAt = OneUptimeDate.addRemoveHours(deadline, -4);
  const rule: IncidentSlaRule = new IncidentSlaRule();
  rule.name = "P1 customer SLA";
  sla.incidentSlaRule = rule;

  if (breach === "response") {
    sla.responseDeadline = deadline;
  } else {
    sla.resolutionDeadline = deadline;
  }

  return sla;
};

const incident: () => Incident = (): Incident => {
  const model: Incident = new Incident();
  model.id = INCIDENT_ID;
  model.projectId = PROJECT_ID;
  model.title = "Checkout API is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
  model.declaredAt = OneUptimeDate.addRemoveHours(deadline, -4);
  const project: Project = new Project();
  project.name = "Acme Prod";
  model.project = project;
  return model;
};

const runTick: () => Promise<Array<SentNotification>> = async (): Promise<
  Array<SentNotification>
> => {
  const handler: CronHandler | undefined =
    mockCapturedJobs["IncidentSla:CheckSlaBreaches"];

  expect(handler).toBeDefined();

  await handler!();

  return notificationService.sendUserNotification.mock.calls.map(
    (args: Array<unknown>): SentNotification => {
      return args[0] as SentNotification;
    },
  );
};

beforeEach(() => {
  jest.clearAllMocks();

  deadline = OneUptimeDate.addRemoveHours(OneUptimeDate.getCurrentDate(), -1);
  callOrder = [];

  slaService.getSlasNeedingBreachCheck.mockResolvedValue([breachedSla()]);
  incidentService.findOneById.mockResolvedValue(incident());
  incidentService.findOwners.mockResolvedValue([new User(OWNER_ID)]);
  incidentService.getIncidentLinkInDashboard.mockResolvedValue(
    URL.fromString(
      `https://oneuptime.com/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`,
    ),
  );
  projectService.getOwners.mockResolvedValue([new User(PROJECT_OWNER_ID)]);
  notificationService.addIncidentSlaBreachedNotificationSettings.mockImplementation(
    (userId: ObjectID): Promise<void> => {
      callOrder.push(`setting ${userId.toString()}`);
      return Promise.resolve();
    },
  );
  notificationService.sendUserNotification.mockImplementation(
    (data: SentNotification): Promise<void> => {
      callOrder.push(`send ${data.userId.toString()}`);
      return Promise.resolve();
    },
  );
});

describe("an SLA breach", () => {
  test("reaches every owner under its own event, never Incident created", async () => {
    incidentService.findOwners.mockResolvedValue([
      new User(OWNER_ID),
      new User(new ObjectID("5114d000-0000-4000-8000-000000000005")),
    ]);

    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(2);

    for (const notification of sent) {
      expect(notification.eventType).toBe(
        NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION,
      );
      expect(notification.projectId.toString()).toBe(PROJECT_ID.toString());
      expect(notification.incidentId.toString()).toBe(INCIDENT_ID.toString());
    }
  });

  test("is emailed with its own template, saying which deadline was missed", async () => {
    const email: EmailEnvelope = (await runTick())[0]!.emailEnvelope;

    expect(email.templateType).toBe(EmailTemplateType.IncidentOwnerSlaBreached);
    expect(email.templateType).not.toBe(
      EmailTemplateType.IncidentOwnerResourceCreated,
    );
    expect(email.subject).toBe(
      "[SLA breached] Incident INC-42 missed its resolution deadline - Checkout API is down",
    );
    expect(email.vars).toMatchObject({
      breachType: "Resolution",
      slaRuleName: "P1 customer SLA",
      projectName: "Acme Prod",
      isOwner: "true",
    });
  });

  test("a missed response deadline says so", async () => {
    slaService.getSlasNeedingBreachCheck.mockResolvedValue([
      breachedSla("response"),
    ]);

    const sent: SentNotification = (await runTick())[0]!;

    expect(sent.emailEnvelope.subject).toContain(
      "missed its response deadline",
    );
    expect(sent.emailEnvelope.vars).toMatchObject({ breachType: "Response" });
    expect(sent.smsMessage.message).toContain(
      "missed its SLA response deadline",
    );
  });

  test("an incident without owners tells the project's owners, and says why they got it", async () => {
    incidentService.findOwners.mockResolvedValue([]);

    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.userId.toString()).toBe(PROJECT_OWNER_ID.toString());
    expect(
      (sent[0]!.emailEnvelope.vars as Record<string, unknown>)["isOwner"],
    ).toBeUndefined();
  });

  test("makes sure each person has the SLA breach setting before they are told", async () => {
    await runTick();

    expect(
      notificationService.addIncidentSlaBreachedNotificationSettings,
    ).toHaveBeenCalledWith(OWNER_ID, PROJECT_ID);
    expect(callOrder).toEqual([
      `setting ${OWNER_ID.toString()}`,
      `send ${OWNER_ID.toString()}`,
    ]);
  });

  test("a setting that cannot be written still lets the breach go out", async () => {
    notificationService.addIncidentSlaBreachedNotificationSettings.mockRejectedValue(
      new Error("database busy"),
    );

    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(1);
  });

  test("asks for no rollup bypass: its event is never rolled up", async () => {
    const sent: SentNotification = (await runTick())[0]!;

    expect("forceImmediate" in sent).toBe(false);
  });
});

describe("the SMS an SLA breach sends the incident's owners", () => {
  test("says which deadline the incident missed, in the words of every notification SMS", async () => {
    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.smsMessage.message).toBe(
      buildNotificationSms(
        "Incident INC-42 (Checkout API is down) missed its SLA resolution deadline.",
      ),
    );
  });

  test("opens with who sends it and closes with where it is turned off, without the old pointer to the Dashboard", async () => {
    const message: string = (await runTick())[0]!.smsMessage.message!;

    expect(message.startsWith("OneUptime: Incident INC-42 ")).toBe(true);
    expect(message.endsWith(` ${NOTIFICATION_SMS_TURN_OFF}`)).toBe(true);
    expect(message).not.toContain("View incident in OneUptime Dashboard.");
  });
});

describe("the WhatsApp message an SLA breach sends", () => {
  test("is Meta's approved still-open reminder, never the has-been-created template", async () => {
    const whatsApp: WhatsAppMessagePayload = (await runTick())[0]!
      .whatsAppMessage;

    expect(whatsApp.templateKey).toBe(
      WhatsAppTemplateIds.IncidentReminderOwnerNotification,
    );
    expect(whatsApp.templateVariables?.["incident_title"]).toBe(
      "Checkout API is down",
    );
    expect(whatsApp.templateVariables?.["incident_number"]).toBe("42");
    expect(whatsApp.body).toContain("is still Open and has been open for");
    expect(whatsApp.body).not.toContain("has been created");
  });
});
