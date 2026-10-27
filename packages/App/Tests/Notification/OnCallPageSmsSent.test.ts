import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import NotificationService from "Common/Server/Services/NotificationService";
import ProjectService from "Common/Server/Services/ProjectService";
import ShortLinkService from "Common/Server/Services/ShortLinkService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import MessagingBalance from "Common/Server/Utils/Billing/MessagingBalance";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SMS from "Common/Types/SMS/SMS";
import {
  countSmsSegments,
  SmsEncoding,
  SmsSegmentCount,
} from "Common/Utils/Sms/SmsSegments";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import Twilio from "twilio";

/*
 * WHAT TWILIO IS HANDED FOR A PAGE.
 *
 * A page's SMS is built by UserNotificationRuleService (its text fitted to
 * one 160-character part, Utils/Sms/OnCallPageSms) and sent by the
 * Notification service's SmsService, which puts the installation's own name
 * in place of OneUptime and hands the body to Twilio. This runs the two
 * real halves back to back - the generator, then sendSms with the message
 * exactly as the /notification/sms/send route passes it on - with Twilio's
 * client faked, and reads what Twilio got:
 *
 * - every kind of page goes out as one GSM-7 part, on OneUptime Cloud's
 *   short link and on a long self-hosted one;
 * - an installation that goes by a longer name still sends one part;
 * - on OneUptime Cloud the project pays for one part, where the page of
 *   14.0.76 (225 characters or more) paid for two.
 */

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
    EXTERNAL_FAULT: {},
  };
});

// Billing per test: CI's config.env turns it on, a local run has it off.
jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    SMSDefaultCostInCents: 10,
    SMSHighRiskCostInCents: 10,
    getTwilioConfig: jest.fn(),
    /*
     * A server that sends its SMS and calls through Twilio, not its own
     * gateway (CallAndSmsGatewayConfig reads the settings row otherwise).
     */
    getCallAndSmsGateway: jest.fn().mockResolvedValue(null as never),
  };
});

import { getTwilioConfig } from "../../FeatureSet/Notification/Config";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

const PROJECT_ID: ObjectID = new ObjectID(
  "5114b000-0000-4000-8000-000000000001",
);
const RECORD_ID: ObjectID = new ObjectID(
  "5114b000-0000-4000-8000-000000000002",
);
const NOTIFICATION_ID: ObjectID = new ObjectID(
  "5114b000-0000-4000-8000-000000000003",
);
const TO: Phone = new Phone("+15555550142");

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TITLE: string =
  "Database replication lag on db-primary-01 is above 30 seconds and still growing";

let host: string;
let createMessage: AsyncMock;
let payments: Array<number>;
let logs: Array<SmsLog>;

const projectRow: () => Project = (): Project => {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.name = "Acme Prod";
  project.enableSmsNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = 10000;
  return project;
};

const projectNamed: () => Project = (): Project => {
  const project: Project = new Project();
  project.name = "Acme Prod";
  return project;
};

const incident: () => Incident = (): Incident => {
  const model: Incident = new Incident();
  model.id = RECORD_ID;
  model.projectId = PROJECT_ID;
  model.project = projectNamed();
  model.title = TITLE;
  model.incidentNumber = 21033;
  model.incidentNumberWithPrefix = "INC-21033";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
};

const alert: () => Alert = (): Alert => {
  const model: Alert = new Alert();
  model.id = RECORD_ID;
  model.projectId = PROJECT_ID;
  model.project = projectNamed();
  model.title = TITLE;
  model.alertNumber = 512;
  model.alertNumberWithPrefix = "ALT-512";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
};

const incidentEpisode: () => IncidentEpisode = (): IncidentEpisode => {
  const model: IncidentEpisode = new IncidentEpisode();
  model.id = RECORD_ID;
  model.projectId = PROJECT_ID;
  model.project = projectNamed();
  model.title = TITLE;
  model.episodeNumber = 7;
  model.episodeNumberWithPrefix = "IE-7";
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Critical Incident";
  model.incidentSeverity = severity;
  return model;
};

const alertEpisode: () => AlertEpisode = (): AlertEpisode => {
  const model: AlertEpisode = new AlertEpisode();
  model.id = RECORD_ID;
  model.projectId = PROJECT_ID;
  model.project = projectNamed();
  model.title = TITLE;
  model.episodeNumber = 3;
  model.episodeNumberWithPrefix = "AE-3";
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;
  return model;
};

interface PageKind {
  name: string;
  build: () => Promise<SMS>;
}

const KINDS: Array<PageKind> = [
  {
    name: "an incident",
    build: () => {
      return UserNotificationRuleService.generateSmsTemplateForIncidentCreated(
        TO,
        incident(),
        NOTIFICATION_ID,
      );
    },
  },
  {
    name: "an alert",
    build: () => {
      return UserNotificationRuleService.generateSmsTemplateForAlertCreated(
        TO,
        alert(),
        NOTIFICATION_ID,
      );
    },
  },
  {
    name: "an incident episode",
    build: () => {
      return UserNotificationRuleService.generateSmsTemplateForIncidentEpisodeCreated(
        TO,
        incidentEpisode(),
        NOTIFICATION_ID,
      );
    },
  },
  {
    name: "an alert episode",
    build: () => {
      return UserNotificationRuleService.generateSmsTemplateForAlertEpisodeCreated(
        TO,
        alertEpisode(),
        NOTIFICATION_ID,
      );
    },
  },
];

const brandAs: (branding: ProductBranding | null) => void = (
  branding: ProductBranding | null,
): void => {
  jest
    .spyOn(EnterpriseEdition, "getProductBranding")
    .mockReturnValue(branding as never);
};

// Sends the page as the /notification/sms/send route would, and reads Twilio's body.
const sendPage: (sms: SMS) => Promise<string> = async (
  sms: SMS,
): Promise<string> => {
  await SmsService.sendSms(sms.to, sms.message, { projectId: PROJECT_ID });

  expect(createMessage).toHaveBeenCalledTimes(1);

  return String(
    (createMessage.mock.calls[0]![0] as { body?: unknown }).body || "",
  );
};

beforeEach(() => {
  host = "oneuptime.com";
  setTestBillingEnabled(false);
  payments = [];
  logs = [];

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return { messages: { create: createMessage } };
  });
  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    TWILIO_CONFIG as never,
  );

  brandAs(null);

  jest.spyOn(DatabaseConfig, "getHost").mockImplementation((async () => {
    return new Hostname(host);
  }) as never);
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest
    .spyOn(ShortLinkService, "saveShortLinkFor")
    .mockResolvedValue({ shortId: "XJlaZRsd" } as never);

  jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
    return Promise.resolve(projectRow());
  }) as never);
  jest
    .spyOn(NotificationService, "rechargeIfBalanceIsLow")
    .mockResolvedValue(10000 as never);
  jest.spyOn(MessagingBalance, "payForSentMessage").mockImplementation(((data: {
    costInUSDCents: number;
  }) => {
    payments.push(data.costInUSDCents);
    return Promise.resolve(10000 - data.costInUSDCents);
  }) as never);
  jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
    data: SmsLog;
  }) => {
    const row: SmsLog = data.data;
    row._id = ObjectID.generate().toString();
    logs.push(row);
    return Promise.resolve(row);
  }) as never);
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("a page about $name", (kind: PageKind) => {
  test("reaches Twilio as the page's text, in one GSM-7 part", async () => {
    const sms: SMS = await kind.build();
    const body: string = await sendPage(sms);
    const counted: SmsSegmentCount = countSmsSegments(body);

    expect(body).toBe(sms.message);
    expect(body.startsWith("OneUptime: ")).toBe(true);
    expect(
      body.endsWith(" Ack or escalate: https://oneuptime.com/l/XJlaZRsd"),
    ).toBe(true);
    expect(counted.encoding).toBe(SmsEncoding.Gsm7);
    expect(counted.segments).toBe(1);
    // The log keeps what was sent.
    expect(logs[0]!.smsText).toBe(body);
  });

  test("stays one part on a long self-hosted address", async () => {
    host = "oneuptime.monitoring.internal.example-corp.com";

    const body: string = await sendPage(await kind.build());

    expect(body).toContain(
      "https://oneuptime.monitoring.internal.example-corp.com/l/XJlaZRsd",
    );
    expect(countSmsSegments(body).segments).toBe(1);
  });

  test("stays one part on an installation that goes by a longer name", async () => {
    brandAs({ productName: "Acme Corporation Monitoring" });

    const body: string = await sendPage(await kind.build());

    expect(body.startsWith("Acme Corporation Monitoring: ")).toBe(true);
    expect(body).not.toContain("OneUptime");
    expect(countSmsSegments(body).segments).toBe(1);
  });

  test("costs the project one part on OneUptime Cloud", async () => {
    setTestBillingEnabled(true);

    await sendPage(await kind.build());

    expect(payments).toEqual([10]);
  });
});

describe("the page text of 14.0.76", () => {
  test("cost two parts for the same page", async () => {
    setTestBillingEnabled(true);

    await sendPage({
      to: TO,
      message:
        "This is a message from OneUptime. A new incident has been created: INC-21033 (API is down). To acknowledge this incident, or pass it on if you can't take it, please click on the following link https://oneuptime.com/l/XJlaZRsd",
    });

    expect(payments).toEqual([20]);
  });
});
