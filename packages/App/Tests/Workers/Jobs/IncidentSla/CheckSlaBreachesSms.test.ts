import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSla from "Common/Models/DatabaseModels/IncidentSla";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import IncidentSlaStatus from "Common/Types/Incident/IncidentSlaStatus";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import {
  buildNotificationSms,
  NOTIFICATION_SMS_TURN_OFF,
} from "Common/Utils/Sms/NotificationSms";

/*
 * THE SMS AN SLA BREACH SENDS THE INCIDENT'S OWNERS.
 *
 * Every SMS a team member chose to get says its news the same way
 * (Utils/Sms/NotificationSms): "OneUptime: <news> Turn off in User Settings >
 * Notification Settings." The SLA breach notice said it its own way - no
 * sender up front, and "View incident in OneUptime Dashboard." at the end -
 * so it is held to those words here, through one tick of the real job: an
 * SLA whose resolution deadline has passed.
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
    },
  };
});

import IncidentSlaService from "Common/Server/Services/IncidentSlaService";
import IncidentService from "Common/Server/Services/IncidentService";
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

interface SentNotification {
  smsMessage: SMSMessage;
  whatsAppMessage: WhatsAppMessagePayload;
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
const notificationService: { sendUserNotification: jest.Mock } =
  UserNotificationSettingService as unknown as {
    sendUserNotification: jest.Mock;
  };

let deadline: Date;

const breachedSla: () => IncidentSla = (): IncidentSla => {
  const sla: IncidentSla = new IncidentSla();
  sla.id = SLA_ID;
  sla.projectId = PROJECT_ID;
  sla.incidentId = INCIDENT_ID;
  sla.status = IncidentSlaStatus.OnTrack;
  sla.slaStartedAt = OneUptimeDate.addRemoveHours(deadline, -4);
  sla.resolutionDeadline = deadline;
  return sla;
};

const incident: () => Incident = (): Incident => {
  const model: Incident = new Incident();
  model.id = INCIDENT_ID;
  model.projectId = PROJECT_ID;
  model.title = "Checkout API is down";
  model.incidentNumber = 42;
  model.incidentNumberWithPrefix = "INC-42";
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

  slaService.getSlasNeedingBreachCheck.mockResolvedValue([breachedSla()]);
  incidentService.findOneById.mockResolvedValue(incident());
  incidentService.findOwners.mockResolvedValue([new User(OWNER_ID)]);
  incidentService.getIncidentLinkInDashboard.mockResolvedValue(
    URL.fromString(
      `https://oneuptime.com/dashboard/${PROJECT_ID.toString()}/incidents/${INCIDENT_ID.toString()}`,
    ),
  );
  notificationService.sendUserNotification.mockResolvedValue(undefined);
});

describe("an SLA breach", () => {
  /*
   * Its WhatsApp template names the project, and the job did not pass it:
   * building the message threw "Missing variable", which the job caught and
   * logged - so no owner heard of a breach on any channel.
   */
  test("reaches every owner, the WhatsApp template's project included", async () => {
    incidentService.findOwners.mockResolvedValue([
      new User(OWNER_ID),
      new User(new ObjectID("5114d000-0000-4000-8000-000000000005")),
    ]);

    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(2);
    expect(sent[0]!.whatsAppMessage.templateVariables?.["project_name"]).toBe(
      "Acme Prod",
    );
    expect(sent[0]!.whatsAppMessage.body).toContain("for project Acme Prod.");
  });
});

describe("the SMS an SLA breach sends the incident's owners", () => {
  test("says the news in the words of every notification SMS", async () => {
    const sent: Array<SentNotification> = await runTick();

    expect(sent).toHaveLength(1);
    expect(sent[0]!.smsMessage.message).toBe(
      buildNotificationSms(
        `SLA Resolution Breached for incident Checkout API is down INC-42. Deadline was ${OneUptimeDate.getDateAsLocalFormattedString(deadline)}.`,
      ),
    );
  });

  test("opens with who sends it and closes with where it is turned off, without the old pointer to the Dashboard", async () => {
    const message: string = (await runTick())[0]!.smsMessage.message!;

    expect(message.startsWith("OneUptime: SLA Resolution Breached ")).toBe(
      true,
    );
    expect(message.endsWith(` ${NOTIFICATION_SMS_TURN_OFF}`)).toBe(true);
    expect(message).not.toContain("View incident in OneUptime Dashboard.");
  });

  test("its WhatsApp message is still the approved template", async () => {
    const whatsApp: WhatsAppMessagePayload = (await runTick())[0]!
      .whatsAppMessage;

    expect(whatsApp.templateKey).toBeTruthy();
    expect(whatsApp.templateVariables?.["incident_title"]).toBe(
      "Checkout API is down",
    );
  });
});
