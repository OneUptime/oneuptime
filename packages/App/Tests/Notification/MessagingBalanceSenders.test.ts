import CallService from "../../FeatureSet/Notification/Services/CallService";
import SmsService from "../../FeatureSet/Notification/Services/SmsService";
import TelegramService from "../../FeatureSet/Notification/Services/TelegramService";
import WhatsAppService from "../../FeatureSet/Notification/Services/WhatsAppService";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Project from "Common/Models/DatabaseModels/Project";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import TelegramLog from "Common/Models/DatabaseModels/TelegramLog";
import WhatsAppLog from "Common/Models/DatabaseModels/WhatsAppLog";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import Redis from "Common/Server/Infrastructure/Redis";
import Semaphore, { SemaphoreMutex } from "Common/Server/Infrastructure/Semaphore";
import BillingService from "Common/Server/Services/BillingService";
import CallLogService from "Common/Server/Services/CallLogService";
import ProjectService from "Common/Server/Services/ProjectService";
import SmsLogService from "Common/Server/Services/SmsLogService";
import TelegramLogService from "Common/Server/Services/TelegramLogService";
import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import WhatsAppLogService from "Common/Server/Services/WhatsAppLogService";
import logger from "Common/Server/Utils/Logger";
import API from "Common/Utils/API";
import CallRequest from "Common/Types/Call/CallRequest";
import CallStatus from "Common/Types/Call/CallStatus";
import TwilioConfig from "Common/Types/CallAndSMS/TwilioConfig";
import ObjectID from "Common/Types/ObjectID";
import Phone from "Common/Types/Phone";
import SmsStatus from "Common/Types/SmsStatus";
import TelegramStatus from "Common/Types/TelegramStatus";
import WhatsAppMessage from "Common/Types/WhatsApp/WhatsAppMessage";
import WhatsAppStatus from "Common/Types/WhatsAppStatus";
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
 * WHAT SMS, CALLS, WHATSAPP AND TELEGRAM DO TO THE PROJECT'S BALANCE.
 *
 * On OneUptime Cloud every message sent on OneUptime's own accounts is paid
 * from the project's balance. This drives the four real senders, with the
 * real Auto Recharge (NotificationService) behind them, against one project
 * row that every write lands on - the credit and the cost added to the row
 * as it is when they run, what the one statement does in Postgres - and
 * holds them to:
 *
 * - a message that went out pays its exact cost, in whole cents, in one
 *   statement; nothing writes back a balance it read before sending (each
 *   sender used to, so of a storm's messages all but one went unpaid, and a
 *   recharge landing in between was written over);
 * - the messages of a storm that find the balance low charge the card once,
 *   and all of them still go out on what it added;
 * - paging never stops for the shared cache: with it down, a message the
 *   balance pays for goes out at once, Auto Recharge charges nothing (two
 *   servers could each charge the card) and says so in the log, and the
 *   next message tries again;
 * - the owners hear the balance is used up once, however many messages find
 *   it so together;
 * - a balance that cannot be written after the provider took the message
 *   leaves the message sent, and says so in the log.
 */

jest.mock("twilio", () => {
  return {
    __esModule: true,
    default: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const URLType: { fromString: (url: string) => unknown } = (
    jest.requireActual("Common/Types/API/URL") as {
      default: { fromString: (url: string) => unknown };
    }
  ).default;

  return {
    __esModule: true,
    ...actual,
    IsBillingEnabled: true,
    DashboardClientUrl: URLType.fromString(
      "https://oneuptime.example.com/dashboard",
    ),
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../FeatureSet/Notification/Config",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    // 29 and 57 cents: the old dollars-and-back arithmetic got these wrong.
    SMSDefaultCostInCents: 7,
    SMSHighRiskCostInCents: 7,
    CallDefaultCostInCentsPerMinute: 57,
    CallHighRiskCostInCentsPerMinute: 57,
    WhatsAppTextDefaultCostInCents: 29,
    TelegramTextDefaultCostInCents: 29,
    getTwilioConfig: jest.fn(),
    getMetaWhatsAppConfig: jest.fn(),
    getTelegramConfig: jest.fn(),
  };
});

import {
  getMetaWhatsAppConfig,
  getTelegramConfig,
  getTwilioConfig,
} from "../../FeatureSet/Notification/Config";

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-0000000000c3",
);

const TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC-account",
  authToken: "auth-token",
  primaryPhoneNumber: new Phone("+14155550100"),
  secondaryPhoneNumbers: [],
};

const TO: Phone = new Phone("+15555550177");

type AsyncMock = Mock<(...args: Array<unknown>) => Promise<unknown>>;

interface Row {
  _id: string;
  name: string;
  paymentProviderCustomerId: string;
  enableSmsNotifications: boolean;
  enableCallNotifications: boolean;
  enableWhatsAppNotifications: boolean;
  enableTelegramNotifications: boolean;
  smsOrCallCurrentBalanceInUSDCents: number;
  enableAutoRechargeSmsOrCallBalance: boolean;
  autoRechargeSmsOrCallByBalanceInUSD: number;
  autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: number;
  lowCallAndSMSBalanceNotificationSentToOwners: boolean;
  failedCallAndSMSBalanceChargeNotificationSentToOwners: boolean;
  notEnabledSmsOrCallNotificationSentToOwners: boolean;
  sendInvoicesByEmail: boolean;
}

let row: Row;
let charges: Array<number>;
let ownerEmails: Array<{ subject: string; body: string }>;
let cache: Map<string, string>;
let isCacheConnected: boolean;
let errors: Array<string>;
let createMessage: AsyncMock;
let createCall: AsyncMock;
const heldLocks: Set<string> = new Set<string>();
const lockQueues: Map<string, Array<() => void>> = new Map();

function wait(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, ms);
  });
}

function toProject(): Project {
  const project: Project = new Project();
  Object.assign(project, row);
  project.id = PROJECT_ID;
  return project;
}

function logged<T>(service: unknown): Array<T> {
  return (service as { create: jest.Mock }).create.mock.calls.map(
    (call: Array<unknown>) => {
      return (call[0] as { data: T }).data;
    },
  );
}

beforeEach(() => {
  row = {
    _id: PROJECT_ID.toString(),
    name: "Acme",
    paymentProviderCustomerId: "cus_messaging_senders",
    enableSmsNotifications: true,
    enableCallNotifications: true,
    enableWhatsAppNotifications: true,
    enableTelegramNotifications: true,
    smsOrCallCurrentBalanceInUSDCents: 5000,
    enableAutoRechargeSmsOrCallBalance: false,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
    lowCallAndSMSBalanceNotificationSentToOwners: false,
    failedCallAndSMSBalanceChargeNotificationSentToOwners: false,
    notEnabledSmsOrCallNotificationSentToOwners: false,
    sendInvoicesByEmail: false,
  };
  charges = [];
  ownerEmails = [];
  cache = new Map<string, string>();
  isCacheConnected = true;
  errors = [];
  heldLocks.clear();
  lockQueues.clear();

  jest.spyOn(logger, "error").mockImplementation(((message: unknown) => {
    errors.push(String(message));
  }) as never);
  jest.spyOn(logger, "debug").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "info").mockImplementation((() => {}) as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {}) as never);

  createMessage = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createMessage.mockResolvedValue({ status: "queued", sid: "SM-1" } as never);
  createCall = jest.fn<(...args: Array<unknown>) => Promise<unknown>>();
  createCall.mockResolvedValue({ sid: "CA-1", duration: "0" } as never);

  (Twilio as unknown as jest.Mock).mockImplementation(() => {
    return {
      messages: { create: createMessage },
      calls: { create: createCall },
    };
  });
  // The call's script is Twilio's business (and twilio is a mock here).
  jest
    .spyOn(CallService, "generateTwimlForCall")
    .mockReturnValue("<Response><Say>Incident</Say></Response>");

  (getTwilioConfig as unknown as jest.Mock).mockResolvedValue(
    TWILIO_CONFIG as never,
  );
  (getMetaWhatsAppConfig as unknown as jest.Mock).mockResolvedValue({
    accessToken: "meta-token",
    phoneNumberId: "meta-phone",
    apiVersion: "v19.0",
  } as never);
  (getTelegramConfig as unknown as jest.Mock).mockResolvedValue({
    botToken: "1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi",
    botUsername: "oneuptime_bot",
  } as never);

  // The project row: every write lands on it.
  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    return toProject();
  }) as never);
  jest.spyOn(ProjectService, "updateOneById").mockImplementation((async (data: {
    data: Record<string, unknown>;
  }) => {
    Object.assign(row, data.data);
    return 1;
  }) as never);
  jest
    .spyOn(ProjectService, "creditSmsOrCallBalanceInUSDCents")
    .mockImplementation((async (data: { amountInUSDCents: number }) => {
      row.smsOrCallCurrentBalanceInUSDCents += data.amountInUSDCents;
      row.lowCallAndSMSBalanceNotificationSentToOwners = false;
      row.failedCallAndSMSBalanceChargeNotificationSentToOwners = false;
      row.notEnabledSmsOrCallNotificationSentToOwners = false;
      return row.smsOrCallCurrentBalanceInUSDCents;
    }) as never);
  jest
    .spyOn(ProjectService, "deductSmsOrCallBalanceInUSDCents")
    .mockImplementation((async (data: { amountInUSDCents: number }) => {
      row.smsOrCallCurrentBalanceInUSDCents -= data.amountInUSDCents;
      row.notEnabledSmsOrCallNotificationSentToOwners = false;
      return row.smsOrCallCurrentBalanceInUSDCents;
    }) as never);
  jest
    .spyOn(ProjectService, "claimSmsOrCallLowBalanceNotice")
    .mockImplementation((async () => {
      if (row.lowCallAndSMSBalanceNotificationSentToOwners) {
        return false;
      }
      row.lowCallAndSMSBalanceNotificationSentToOwners = true;
      return true;
    }) as never);
  jest
    .spyOn(ProjectService, "sendEmailToProjectOwners")
    .mockImplementation((async (
      _id: ObjectID,
      subject: string,
      body: string,
    ) => {
      ownerEmails.push({ subject, body });
    }) as never);

  // The payment provider: a charge takes a moment.
  jest.spyOn(BillingService, "hasPaymentMethods").mockResolvedValue(true);
  jest
    .spyOn(BillingService, "generateInvoiceAndChargeCustomer")
    .mockImplementation((async (
      _customerId: string,
      _itemText: string,
      amountInUsd: number,
    ) => {
      await wait(30);
      charges.push(amountInUsd);
    }) as never);

  // The shared cache and the lock (a real mutual exclusion, in process).
  jest.spyOn(Redis, "isConnected").mockImplementation((): boolean => {
    return isCacheConnected;
  });
  jest.spyOn(GlobalCache, "getString").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    if (!isCacheConnected) {
      throw new Error("Cache is not connected");
    }
    return cache.get(`${namespace}-${key}`) || null;
  }) as never);
  jest.spyOn(GlobalCache, "setString").mockImplementation((async (
    namespace: string,
    key: string,
    value: string,
  ) => {
    cache.set(`${namespace}-${key}`, value);
  }) as never);
  jest.spyOn(GlobalCache, "deleteKey").mockImplementation((async (
    namespace: string,
    key: string,
  ) => {
    cache.delete(`${namespace}-${key}`);
  }) as never);
  jest.spyOn(GlobalCache, "setStringIfNotExists").mockResolvedValue(true);
  jest.spyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
    namespace: string;
  }) => {
    const name: string = `${data.namespace}-${data.key}`;

    while (heldLocks.has(name)) {
      await new Promise<void>((resolve: () => void) => {
        const queue: Array<() => void> = lockQueues.get(name) || [];
        queue.push(resolve);
        lockQueues.set(name, queue);
      });
    }

    heldLocks.add(name);
    return { name } as unknown as SemaphoreMutex;
  }) as never);
  jest.spyOn(Semaphore, "release").mockImplementation((async (
    mutex: SemaphoreMutex,
  ) => {
    const name: string = (mutex as unknown as { name: string }).name;
    heldLocks.delete(name);
    lockQueues.get(name)?.shift()?.();
  }) as never);

  // The logs and the on-call timeline.
  for (const service of [
    SmsLogService,
    CallLogService,
    WhatsAppLogService,
    TelegramLogService,
  ]) {
    jest.spyOn(service as never, "create").mockImplementation(((data: {
      data: { _id?: string };
    }) => {
      data.data._id = ObjectID.generate().toString();
      return Promise.resolve(data.data);
    }) as never);
  }
  jest
    .spyOn(SmsLogService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserOnCallLogTimelineService, "markNotSent")
    .mockResolvedValue(undefined as never);
  jest.spyOn(API, "post").mockResolvedValue({
    jsonData: {
      ok: true,
      result: { message_id: "telegram-message-id" },
      messages: [{ id: "wamid-1" }],
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function call(): CallRequest {
  return {
    to: TO,
    data: [{ sayMessage: "Incident Checkout down." }],
  } as unknown as CallRequest;
}

function whatsApp(): WhatsAppMessage {
  return {
    to: TO,
    body: "Incident Checkout down.",
    templateKey: "oneuptime_incident_created",
  } as unknown as WhatsAppMessage;
}

interface Channel {
  name: string;
  costInUSDCents: number;
  send: () => Promise<void>;
  sentTimes: () => number;
}

const CHANNELS: Array<Channel> = [
  {
    name: "SMS",
    costInUSDCents: 7,
    send: async (): Promise<void> => {
      await SmsService.sendSms(TO, "Incident Checkout down.", {
        projectId: PROJECT_ID,
      });
    },
    sentTimes: (): number => {
      return createMessage.mock.calls.length;
    },
  },
  {
    name: "call",
    costInUSDCents: 57,
    send: async (): Promise<void> => {
      await CallService.makeCall(call(), { projectId: PROJECT_ID });
    },
    sentTimes: (): number => {
      return createCall.mock.calls.length;
    },
  },
  {
    name: "WhatsApp",
    costInUSDCents: 29,
    send: async (): Promise<void> => {
      await WhatsAppService.sendWhatsApp(whatsApp(), {
        projectId: PROJECT_ID,
      });
    },
    sentTimes: (): number => {
      return (API.post as unknown as jest.Mock).mock.calls.length;
    },
  },
  {
    name: "Telegram",
    costInUSDCents: 29,
    send: async (): Promise<void> => {
      await TelegramService.sendTelegram(
        { to: "123456789", body: "Incident Checkout down." },
        { projectId: PROJECT_ID },
      );
    },
    sentTimes: (): number => {
      return (API.post as unknown as jest.Mock).mock.calls.length;
    },
  },
];

describe.each(CHANNELS)("a $name message", (channel: Channel) => {
  test("pays its exact cost, in whole cents, in one statement", async () => {
    await channel.send();

    expect(channel.sentTimes()).toBe(1);
    expect(ProjectService.deductSmsOrCallBalanceInUSDCents).toHaveBeenCalledWith(
      {
        projectId: PROJECT_ID,
        amountInUSDCents: channel.costInUSDCents,
      },
    );
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(
      5000 - channel.costInUSDCents,
    );
  });

  test("never writes back a balance it worked out itself", async () => {
    await channel.send();

    for (const update of (
      ProjectService.updateOneById as unknown as jest.Mock
    ).mock.calls) {
      expect(
        Object.keys((update[0] as { data: Record<string, unknown> }).data),
      ).not.toContain("smsOrCallCurrentBalanceInUSDCents");
    }
  });

  test("ten sent together all pay (each used to write back the balance it read, less its cost)", async () => {
    await Promise.all(
      Array.from({ length: 10 }, () => {
        return channel.send();
      }),
    );

    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(
      5000 - 10 * channel.costInUSDCents,
    );
  });

  test("a recharge landing while it is sent keeps its cost, and the recharge keeps its credit", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 900;
    row.enableAutoRechargeSmsOrCallBalance = true;

    await channel.send();

    // Recharged once (it found 9 USD, below 10), then paid for itself.
    expect(charges).toEqual([20]);
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(
      900 + 2000 - channel.costInUSDCents,
    );
  });

  test("the shared cache is down: the message the balance pays for still goes out at once; Auto Recharge charges nothing and says why", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 900;
    row.enableAutoRechargeSmsOrCallBalance = true;
    isCacheConnected = false;

    const startedAt: number = Date.now();
    await channel.send();

    expect(Date.now() - startedAt).toBeLessThan(2000);
    expect(channel.sentTimes()).toBe(1);
    expect(Semaphore.lock).not.toHaveBeenCalled();
    expect(charges).toEqual([]);
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(
      900 - channel.costInUSDCents,
    );
    expect(
      errors.some((line: string) => {
        return line.includes(
          "did not run: the recharge lock could not be taken",
        );
      }),
    ).toBe(true);
  });

  test("the shared cache is back: the next message recharges", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 900;
    row.enableAutoRechargeSmsOrCallBalance = true;
    isCacheConnected = false;
    await channel.send();
    expect(charges).toEqual([]);

    isCacheConnected = true;
    await channel.send();

    expect(charges).toEqual([20]);
  });

  test("a balance that cannot be written after the provider took it: the message stays sent, and the log says what it cost", async () => {
    (
      ProjectService.deductSmsOrCallBalanceInUSDCents as unknown as jest.Mock
    ).mockImplementation((async () => {
      throw new Error("connection lost");
    }) as never);

    await expect(channel.send()).resolves.toBeUndefined();

    expect(channel.sentTimes()).toBe(1);
    expect(
      errors.some((line: string) => {
        return (
          line.includes(
            `(${channel.costInUSDCents} cents) could not be taken from the balance`,
          ) && line.includes("connection lost")
        );
      }),
    ).toBe(true);
    expect(UserOnCallLogTimelineService.markNotSent).not.toHaveBeenCalled();
  });
});

describe("the log of each message records what it cost, in whole cents", () => {
  test("SMS", async () => {
    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    const update: { data: { smsCostInUSDCents: number; status: string } } = (
      SmsLogService.updateColumnsByIdWithoutHooks as unknown as jest.Mock
    ).mock.calls[0]![0] as {
      data: { smsCostInUSDCents: number; status: string };
    };

    // 7 cents, where the old arithmetic logged 7.000000000000001.
    expect(update.data.smsCostInUSDCents).toBe(7);
    expect(update.data.status).not.toBe(SmsStatus.Error);
  });

  test("a call", async () => {
    await CallService.makeCall(call(), { projectId: PROJECT_ID });

    const log: CallLog = logged<CallLog>(CallLogService)[0]!;

    expect(log.callCostInUSDCents).toBe(57);
    expect(log.status).toBe(CallStatus.Success);
  });

  test("WhatsApp: 29 cents, where the old arithmetic took and logged 28", async () => {
    await WhatsAppService.sendWhatsApp(whatsApp(), { projectId: PROJECT_ID });

    const log: WhatsAppLog = logged<WhatsAppLog>(WhatsAppLogService).pop()!;

    expect(log.whatsAppCostInUSDCents).toBe(29);
    expect(log.status).toBe(WhatsAppStatus.Sent);
  });

  test("Telegram: 29 cents, where the old arithmetic took and logged 28", async () => {
    await TelegramService.sendTelegram(
      { to: "123456789", body: "Incident Checkout down." },
      { projectId: PROJECT_ID },
    );

    const log: TelegramLog = logged<TelegramLog>(TelegramLogService).pop()!;

    expect(log.telegramCostInUSDCents).toBe(29);
    expect(log.status).toBe(TelegramStatus.Sent);
  });

  test("an SMS in two parts pays for both", async () => {
    await SmsService.sendSms(TO, "x".repeat(200), { projectId: PROJECT_ID });

    expect(ProjectService.deductSmsOrCallBalanceInUSDCents).toHaveBeenCalledWith(
      { projectId: PROJECT_ID, amountInUSDCents: 14 },
    );
  });
});

describe("a paging storm that finds the balance low", () => {
  test("ten SMS at once with Auto Recharge on: the card is charged once, and all ten go out and pay", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 0;
    row.enableAutoRechargeSmsOrCallBalance = true;

    await Promise.all(
      Array.from({ length: 10 }, () => {
        return SmsService.sendSms(TO, "Incident Checkout down.", {
          projectId: PROJECT_ID,
        });
      }),
    );

    // Each used to charge the card.
    expect(charges).toEqual([20]);
    expect(createMessage).toHaveBeenCalledTimes(10);
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(2000 - 10 * 7);
    // An automatic recharge mails nobody.
    expect(ownerEmails).toEqual([]);
  });

  test("an SMS, a call, a WhatsApp and a Telegram message at once share one recharge", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 0;
    row.enableAutoRechargeSmsOrCallBalance = true;

    await Promise.all(
      CHANNELS.map((channel: Channel) => {
        return channel.send();
      }),
    );

    expect(charges).toEqual([20]);
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(
      2000 - (7 + 57 + 29 + 29),
    );
  });

  test("the balance used up, Auto Recharge off: none goes out, and the owners are emailed once", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 0;

    await Promise.all(
      Array.from({ length: 8 }, () => {
        return SmsService.sendSms(TO, "Incident Checkout down.", {
          projectId: PROJECT_ID,
        });
      }),
    );

    expect(createMessage).not.toHaveBeenCalled();
    expect(
      logged<SmsLog>(SmsLogService).filter((log: SmsLog) => {
        return log.status === SmsStatus.LowBalance;
      }),
    ).toHaveLength(8);
    // Each used to read "not told yet" and email every owner.
    expect(ownerEmails).toHaveLength(1);
    expect(ownerEmails[0]!.subject).toBe("Low SMS and Call Balance for Acme");
  });

  test("used up, and every channel finds it so together: still one email", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 0;

    await Promise.all(
      CHANNELS.map((channel: Channel) => {
        return channel.send();
      }),
    );

    expect(ownerEmails).toHaveLength(1);
  });

  test("the shared cache down and the balance used up: not sent, as with Auto Recharge off - and nothing charged", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 0;
    row.enableAutoRechargeSmsOrCallBalance = true;
    isCacheConnected = false;

    await SmsService.sendSms(TO, "Incident Checkout down.", {
      projectId: PROJECT_ID,
    });

    expect(createMessage).not.toHaveBeenCalled();
    expect(charges).toEqual([]);
    expect(logged<SmsLog>(SmsLogService)[0]!.status).toBe(
      SmsStatus.LowBalance,
    );
  });

  test("the card declined: the messages the balance still pays for go out, and the card is tried once", async () => {
    row.smsOrCallCurrentBalanceInUSDCents = 900;
    row.enableAutoRechargeSmsOrCallBalance = true;
    (
      BillingService.generateInvoiceAndChargeCustomer as unknown as jest.Mock
    ).mockImplementation((async () => {
      await wait(10);
      throw new Error("Your card was declined.");
    }) as never);

    for (let message: number = 0; message < 5; message++) {
      await SmsService.sendSms(TO, "Incident Checkout down.", {
        projectId: PROJECT_ID,
      });
    }

    expect(createMessage).toHaveBeenCalledTimes(5);
    // Tried once: Auto Recharge waits an hour after a failed charge.
    expect(
      BillingService.generateInvoiceAndChargeCustomer,
    ).toHaveBeenCalledTimes(1);
    expect(row.smsOrCallCurrentBalanceInUSDCents).toBe(900 - 5 * 7);
  });
});
