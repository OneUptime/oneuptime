import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import StatusPageSubscriberUnsubscribe from "Common/Types/StatusPage/StatusPageSubscriberUnsubscribe";
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
 * A status page subscriber's SMS carries its unsubscribe link, and the token
 * in that link lets whoever holds it cancel the subscription without signing
 * in - on a private status page too. The SMS log keeps the text of every SMS
 * a project sends, and project members who may not touch subscribers can
 * read it (SmsLog.smsText: Viewer, Read SMS Log). So the log, and the owners'
 * email about an SMS that could not be sent, keep the link with its token
 * redacted; only Twilio gets the message as written.
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

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SUBSCRIBER_ID: string = "30000000-0000-4000-8000-000000000003";
const TOKEN: string = "0123456789abcdef".repeat(4);

const UNSUBSCRIBE_URL: string = `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`;
const REDACTED_URL: string = `https://status.acme.com/unsubscribe/${SUBSCRIBER_ID}-[redacted]`;
const MESSAGE: string = `Incident Checkout down (Critical) on Site 03. Impact: Checkout API. Details: https://status.acme.com/incidents/1. Unsub: ${UNSUBSCRIBE_URL}`;

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550123");

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

let createMessage: AsyncMock;
let project: Project;

function loggedRows(): Array<SmsLog> {
  return (SmsLogService.create as unknown as jest.Mock).mock.calls.map(
    (call: Array<unknown>): SmsLog => {
      return (call[0] as { data: SmsLog }).data;
    },
  );
}

function send(
  message: string,
  options?: { isSensitive?: boolean | undefined },
): Promise<void> {
  return SmsService.sendSms(TO, message, {
    projectId: PROJECT_ID,
    statusPageId: STATUS_PAGE_ID,
    customTwilioConfig: TWILIO_CONFIG,
    ...(options?.isSensitive !== undefined
      ? { isSensitive: options.isSensitive }
      : {}),
  });
}

describe("the SMS log never keeps an unsubscribe link's token", () => {
  beforeEach(() => {
    createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
    createMessage.mockResolvedValue({
      status: "queued",
      sid: "SM-1",
    } as never);

    (Twilio as unknown as jest.Mock).mockImplementation(() => {
      return { messages: { create: createMessage } };
    });

    project = new Project();
    project._id = PROJECT_ID.toString();
    project.name = "Acme";
    project.enableSmsNotifications = true;
    project.smsOrCallCurrentBalanceInUSDCents = 10000;

    jest.spyOn(ProjectService, "findOneById").mockImplementation((() => {
      return Promise.resolve(project);
    }) as never);
    jest.spyOn(ProjectService, "updateOneById").mockResolvedValue(1 as never);
    jest
      .spyOn(ProjectService, "sendEmailToProjectOwners")
      .mockResolvedValue(undefined as never);

    jest.spyOn(SmsLogService, "create").mockImplementation(((data: {
      data: SmsLog;
    }) => {
      const row: SmsLog = data.data;
      row._id = ObjectID.generate().toString();
      return Promise.resolve(row);
    }) as never);
    jest
      .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
      .mockResolvedValue(undefined as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("Twilio gets the link as written, the log gets it with the token redacted", async () => {
    await send(MESSAGE);

    expect(createMessage).toHaveBeenCalledTimes(1);
    expect(
      (createMessage.mock.calls[0]![0] as { body: string }).body,
    ).toContain(UNSUBSCRIBE_URL);

    const rows: Array<SmsLog> = loggedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.smsText).toBe(
      MESSAGE.replace(UNSUBSCRIBE_URL, REDACTED_URL),
    );
    expect(rows[0]!.smsText).not.toContain(TOKEN);
    // Still says which subscription and which status page it went to.
    expect(rows[0]!.smsText).toContain(`/unsubscribe/${SUBSCRIBER_ID}-`);
    expect(rows[0]!.statusPageId?.toString()).toBe(STATUS_PAGE_ID.toString());
  });

  test("a status page on its default address is redacted the same way", async () => {
    const link: string = `https://oneuptime.acme.com/status-page/${STATUS_PAGE_ID.toString()}/unsubscribe/${SUBSCRIBER_ID}-${TOKEN}`;

    await send(
      `You have been subscribed to Site 03. To unsubscribe, click on the link: ${link}`,
    );

    expect(loggedRows()[0]!.smsText).toBe(
      `You have been subscribed to Site 03. To unsubscribe, click on the link: https://oneuptime.acme.com/status-page/${STATUS_PAGE_ID.toString()}/unsubscribe/${SUBSCRIBER_ID}-[redacted]`,
    );
  });

  test("a message without an unsubscribe link is logged as written", async () => {
    const plain: string =
      "Incident update: Checkout down on Site 03. Details: https://status.acme.com/incidents/1. Unsub: https://status.acme.com/update-subscription/30000000-0000-4000-8000-000000000003";

    await send(plain);

    expect(loggedRows()[0]!.smsText).toBe(plain);
  });

  test("a sensitive message is still not logged at all", async () => {
    await send(MESSAGE, { isSensitive: true });

    expect(loggedRows()[0]!.smsText).toBe(
      "This message is sensitive and is not logged",
    );
  });

  test("the owners' email about an SMS that could not be sent quotes the redacted text", async () => {
    project.enableSmsNotifications = false;

    await send(MESSAGE);

    expect(createMessage).not.toHaveBeenCalled();
    expect(loggedRows()[0]!.smsText).not.toContain(TOKEN);

    const body: string = (
      ProjectService.sendEmailToProjectOwners as unknown as jest.Mock
    ).mock.calls[0]![2] as string;

    expect(body).toContain(REDACTED_URL);
    expect(body).not.toContain(TOKEN);
  });

  /*
   * The owners' email places its message as HTML (SimpleMessage's info
   * block), and the SMS text is plain text built from incident titles,
   * resource names and custom field values. Markup in it is shown, never
   * rendered - a title must not become a live link in an email from us.
   */
  test("the owners' email shows markup in the SMS text as text", async () => {
    project.enableSmsNotifications = false;

    await send(
      `Incident <a href="https://evil.example">Verify billing</a> & more on Site 03. Unsub: ${UNSUBSCRIBE_URL}`,
    );

    const body: string = (
      ProjectService.sendEmailToProjectOwners as unknown as jest.Mock
    ).mock.calls[0]![2] as string;

    /*
     * No link from the SMS text. The only link the email may carry is its
     * own, to the switch on Notification Settings (when the dashboard's
     * address is configured).
     */
    expect(body).not.toContain('<a href="https://evil.example"');

    const SETTINGS_LINK: RegExp = /\/settings\/notification-settings"$/;

    for (const anchor of body.match(/<a href="[^"]*"/g) || []) {
      expect(anchor).toMatch(SETTINGS_LINK);
    }
    expect(body).toContain(
      "Incident &lt;a href=&quot;https://evil.example&quot;&gt;Verify billing&lt;/a&gt; &amp; more on Site 03.",
    );
    // The email's own line breaks are still HTML.
    expect(body).toContain("with message: <br/> <br/> Incident &lt;a");
    expect(body).toContain(REDACTED_URL);
  });

  test("uses the same redaction the link's own module defines", () => {
    expect(StatusPageSubscriberUnsubscribe.redactCredentials(MESSAGE)).toBe(
      MESSAGE.replace(UNSUBSCRIBE_URL, REDACTED_URL),
    );
  });
});
