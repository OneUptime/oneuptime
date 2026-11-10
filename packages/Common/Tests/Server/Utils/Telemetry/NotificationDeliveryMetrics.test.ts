import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * NOTIFICATION DELIVERY METRICS (issue #6600): what the platform's operator
 * defines delivery SLOs on.
 *
 * These pin what every sender records through - the metric each signal goes
 * to, its attribute names, their bounded values, the outcome a send ends
 * with - and that recording a metric never fails a send.
 *
 * And what they record since: where a Slack, Microsoft Teams or Mattermost
 * message went (notification.destination, issue #6645), and how a message
 * a provider accepted ended, when the provider tells it later
 * (notification.delivery.count and .duration, issue #6648).
 */

interface RecordedCall {
  value: number;
  attributes: Record<string, string>;
}

const sendCounterCalls: Array<RecordedCall> = [];
const sendDurationCalls: Array<RecordedCall> = [];
const triggerCounterCalls: Array<RecordedCall> = [];
const timeToSendCalls: Array<RecordedCall> = [];
const deliveryCounterCalls: Array<RecordedCall> = [];
const deliveryDurationCalls: Array<RecordedCall> = [];

let failInstruments: boolean = false;

function instrument(calls: Array<RecordedCall>): {
  add: (value: number, attributes: Record<string, string>) => void;
  record: (value: number, attributes: Record<string, string>) => void;
} {
  const capture: (value: number, attributes: Record<string, string>) => void = (
    value: number,
    attributes: Record<string, string>,
  ): void => {
    if (failInstruments) {
      throw new Error("The metrics SDK fell over.");
    }

    calls.push({ value, attributes });
  };

  return { add: capture, record: capture };
}

jest.mock("../../../../Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return instrument(sendCounterCalls);
      },
      getNotificationDuration: () => {
        return instrument(sendDurationCalls);
      },
      getNotificationTriggerCounter: () => {
        return instrument(triggerCounterCalls);
      },
      getNotificationTimeToSend: () => {
        return instrument(timeToSendCalls);
      },
      getNotificationDeliveryCounter: () => {
        return instrument(deliveryCounterCalls);
      },
      getNotificationDeliveryDuration: () => {
        return instrument(deliveryDurationCalls);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

import NotificationDeliveryMetrics, {
  MAX_CUSTOM_CHANNEL_NAME_LENGTH,
  NotificationDeliveryChannel,
  NotificationDeliveryOutcome,
  NotificationDeliveryProvider,
  NotificationDeliveryStatus,
  NotificationDestination,
  NotificationDispatch,
  NotificationMetricAttribute,
  NotificationProviderConfig,
  NotificationTriggerSource,
  NotificationTriggerType,
  OnCallPageStart,
} from "../../../../Server/Utils/Telemetry/NotificationDeliveryMetrics";
import logger from "../../../../Server/Utils/Logger";
import MailTransportType from "../../../../Types/Email/MailTransportType";
import SmsStatus from "../../../../Types/SmsStatus";
import WhatsAppStatus from "../../../../Types/WhatsAppStatus";
import {
  ON_CALL_PAGE_CHANNELS,
  OnCallPageChannel,
  OnCallPageChannelInfo,
} from "../../../../Types/OnCallDutyPolicy/OnCallPageChannel";

beforeEach(() => {
  jest.clearAllMocks();
  sendCounterCalls.length = 0;
  sendDurationCalls.length = 0;
  triggerCounterCalls.length = 0;
  timeToSendCalls.length = 0;
  deliveryCounterCalls.length = 0;
  deliveryDurationCalls.length = 0;
  failInstruments = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

const CUSTOM_CHANNEL_ID: string = "6600c0de-0000-4000-8000-000000000001";

function lastSendAttributes(): Record<string, string> {
  expect(sendCounterCalls.length).toBeGreaterThan(0);
  return sendCounterCalls[sendCounterCalls.length - 1]!.attributes;
}

describe("the attributes a send is recorded with", () => {
  test("name its channel, provider, whose account, whether it is a page, and how it went", () => {
    expect(
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.SMS,
        provider: NotificationDeliveryProvider.Twilio,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: true,
        outcome: NotificationDeliveryOutcome.Success,
      }),
    ).toEqual({
      "notification.channel": "sms",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
  });

  test("a message that is not a page says so", () => {
    expect(
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.Email,
        provider: NotificationDeliveryProvider.SMTP,
        providerConfig: NotificationProviderConfig.Project,
        isOnCallPage: false,
        outcome: NotificationDeliveryOutcome.Failure,
      }),
    ).toEqual({
      "notification.channel": "email",
      "notification.provider": "smtp",
      "notification.provider.config": "project",
      "notification.on_call_page": "false",
      outcome: "failure",
    });
  });

  test("a custom channel adds its id and its name, so each of an installation's channels is told apart", () => {
    expect(
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: true,
        customChannel: { id: CUSTOM_CHANNEL_ID, name: "CorpoApp" },
        outcome: NotificationDeliveryOutcome.Success,
      }),
    ).toEqual({
      "notification.channel": "custom_channel",
      "notification.provider": "custom_channel",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      "notification.custom_channel.id": CUSTOM_CHANNEL_ID,
      "notification.custom_channel.name": "CorpoApp",
      outcome: "success",
    });
  });

  test("a custom channel's name is trimmed, and cut to a bounded length", () => {
    const longName: string = `  ${"Pager".repeat(60)}  `;

    const attributes: Record<string, string> =
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: false,
        customChannel: { id: CUSTOM_CHANNEL_ID, name: longName },
        outcome: NotificationDeliveryOutcome.Success,
      });

    const name: string = attributes["notification.custom_channel.name"]!;

    expect(name.length).toBe(MAX_CUSTOM_CHANNEL_NAME_LENGTH);
    expect(name.startsWith("PagerPager")).toBe(true);
    expect(name).toBe(name.trim());
  });

  test("a custom channel with no name, or a blank one, carries its id alone", () => {
    for (const name of [undefined, "", "   "]) {
      const attributes: Record<string, string> =
        NotificationDeliveryMetrics.getDispatchAttributes({
          channel: NotificationDeliveryChannel.CustomChannel,
          provider: NotificationDeliveryProvider.CustomChannel,
          providerConfig: NotificationProviderConfig.Global,
          isOnCallPage: false,
          customChannel: { id: CUSTOM_CHANNEL_ID, name: name },
          outcome: NotificationDeliveryOutcome.NotSent,
        });

      expect(attributes["notification.custom_channel.id"]).toBe(
        CUSTOM_CHANNEL_ID,
      );
      expect("notification.custom_channel.name" in attributes).toBe(false);
    }
  });

  test("a custom channel with no id adds nothing", () => {
    const attributes: Record<string, string> =
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.CustomChannel,
        provider: NotificationDeliveryProvider.CustomChannel,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: false,
        customChannel: { id: "", name: "CorpoApp" },
        outcome: NotificationDeliveryOutcome.NotSent,
      });

    expect("notification.custom_channel.id" in attributes).toBe(false);
    expect("notification.custom_channel.name" in attributes).toBe(false);
  });
});

describe("a send, from start to end", () => {
  test("starts with no provider, the server's own account, and as no page", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.Push,
      });

    expect(dispatch.getProvider()).toBe(NotificationDeliveryProvider.None);
    expect(dispatch.getOutcome()).toBeUndefined();
    expect(dispatch.getAttributes(NotificationDeliveryOutcome.Success)).toEqual(
      {
        "notification.channel": "push",
        "notification.provider": "none",
        "notification.provider.config": "global",
        "notification.on_call_page": "false",
        outcome: "success",
      },
    );
  });

  test("ending it records one send and its duration, with the same attributes", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.Call,
        provider: NotificationDeliveryProvider.Twilio,
        isOnCallPage: true,
      });

    dispatch.end(NotificationDeliveryOutcome.Success);

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendCounterCalls[0]!.value).toBe(1);
    expect(sendDurationCalls).toHaveLength(1);
    expect(sendDurationCalls[0]!.value).toBeGreaterThanOrEqual(0);
    expect(sendDurationCalls[0]!.attributes).toEqual(
      sendCounterCalls[0]!.attributes,
    );
    expect(sendCounterCalls[0]!.attributes).toEqual({
      "notification.channel": "call",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      outcome: "success",
    });
    expect(dispatch.isRecorded()).toBe(true);
  });

  test("ending it twice records it once", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.SMS,
      });

    dispatch.end(NotificationDeliveryOutcome.Failure);
    dispatch.end(NotificationDeliveryOutcome.Success);
    dispatch.end(NotificationDeliveryOutcome.NotSent);

    expect(sendCounterCalls).toHaveLength(1);
    expect(sendDurationCalls).toHaveLength(1);
    expect(lastSendAttributes()["outcome"]).toBe("failure");
  });

  test("the duration is the time the send took", async () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.Email,
      });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 25);
    });

    dispatch.end(NotificationDeliveryOutcome.Success);

    expect(sendDurationCalls[0]!.value).toBeGreaterThanOrEqual(20);
    expect(sendDurationCalls[0]!.value).toBeLessThan(10_000);
  });

  test.each([
    {
      mark: "markSucceeded",
      endedWith: NotificationDeliveryOutcome.Failure,
      recorded: "success",
    },
    {
      mark: "markFailed",
      endedWith: NotificationDeliveryOutcome.Success,
      recorded: "failure",
    },
    {
      mark: "markNotSent",
      endedWith: NotificationDeliveryOutcome.Failure,
      recorded: "not_sent",
    },
    {
      mark: "markNotSent",
      endedWith: NotificationDeliveryOutcome.Success,
      recorded: "not_sent",
    },
  ])(
    "an outcome marked with $mark wins over the $endedWith it is ended with",
    (data: {
      mark: string;
      endedWith: NotificationDeliveryOutcome;
      recorded: string;
    }) => {
      const dispatch: NotificationDispatch =
        NotificationDeliveryMetrics.startDispatch({
          channel: NotificationDeliveryChannel.SMS,
        });

      (dispatch as unknown as Record<string, () => void>)[data.mark]!();
      dispatch.end(data.endedWith);

      expect(lastSendAttributes()["outcome"]).toBe(data.recorded);
    },
  );

  test("the last outcome marked is the one recorded", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.SMS,
      });

    dispatch.markFailed();
    dispatch.markSucceeded();
    dispatch.end(NotificationDeliveryOutcome.Failure);

    expect(lastSendAttributes()["outcome"]).toBe("success");
  });

  test("what it learns on the way - its provider, whose account, the custom channel, that it is a page - is recorded", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.CustomChannel,
      });

    dispatch.setProvider(
      NotificationDeliveryProvider.CustomChannel,
      NotificationProviderConfig.Global,
    );
    dispatch.setCustomChannel({ id: CUSTOM_CHANNEL_ID, name: "CorpoApp" });
    dispatch.setIsOnCallPage(true);
    dispatch.end(NotificationDeliveryOutcome.Success);

    expect(lastSendAttributes()).toEqual({
      "notification.channel": "custom_channel",
      "notification.provider": "custom_channel",
      "notification.provider.config": "global",
      "notification.on_call_page": "true",
      "notification.custom_channel.id": CUSTOM_CHANNEL_ID,
      "notification.custom_channel.name": "CorpoApp",
      outcome: "success",
    });
  });

  test("a provider set without an account keeps the account it had", () => {
    const dispatch: NotificationDispatch =
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.SMS,
        providerConfig: NotificationProviderConfig.Project,
      });

    dispatch.setProvider(NotificationDeliveryProvider.Twilio);
    dispatch.end(NotificationDeliveryOutcome.Success);

    expect(lastSendAttributes()["notification.provider.config"]).toBe(
      "project",
    );
    expect(lastSendAttributes()["notification.provider"]).toBe("twilio");
  });
});

describe("measuring a send", () => {
  test("one that returns is a success, and its value is passed on", async () => {
    const value: string = await NotificationDeliveryMetrics.measureDispatch(
      { channel: NotificationDeliveryChannel.Telegram },
      async (): Promise<string> => {
        return "message-id";
      },
    );

    expect(value).toBe("message-id");
    expect(sendCounterCalls).toHaveLength(1);
    expect(lastSendAttributes()["outcome"]).toBe("success");
  });

  test("one that throws is a failure, and the very error is thrown on", async () => {
    const error: Error = new Error("Twilio said no.");

    await expect(
      NotificationDeliveryMetrics.measureDispatch(
        { channel: NotificationDeliveryChannel.SMS },
        async (): Promise<void> => {
          throw error;
        },
      ),
    ).rejects.toBe(error);

    expect(sendCounterCalls).toHaveLength(1);
    expect(lastSendAttributes()["outcome"]).toBe("failure");
  });

  test("one marked not sent that then throws - a caller that asked for it to - stays not sent", async () => {
    await expect(
      NotificationDeliveryMetrics.measureDispatch(
        { channel: NotificationDeliveryChannel.SMS },
        async (dispatch: NotificationDispatch): Promise<void> => {
          dispatch.markNotSent();
          throw new Error("SMS not sent: the project turned SMS off.");
        },
      ),
    ).rejects.toThrow("SMS not sent");

    expect(lastSendAttributes()["outcome"]).toBe("not_sent");
  });

  test("one marked a success that then throws - its log could not be written - stays a success", async () => {
    await expect(
      NotificationDeliveryMetrics.measureDispatch(
        { channel: NotificationDeliveryChannel.WhatsApp },
        async (dispatch: NotificationDispatch): Promise<void> => {
          dispatch.markSucceeded();
          throw new Error("The database went away.");
        },
      ),
    ).rejects.toThrow("The database went away.");

    expect(lastSendAttributes()["outcome"]).toBe("success");
  });

  test("one that returns after it was marked failed - a webhook answered 500 - is a failure", async () => {
    await NotificationDeliveryMetrics.measureDispatch(
      { channel: NotificationDeliveryChannel.Webhook },
      async (dispatch: NotificationDispatch): Promise<void> => {
        dispatch.markFailed();
      },
    );

    expect(lastSendAttributes()["outcome"]).toBe("failure");
  });

  test("the provider the send picks is recorded", async () => {
    await NotificationDeliveryMetrics.measureDispatch(
      { channel: NotificationDeliveryChannel.SMS, isOnCallPage: true },
      async (dispatch: NotificationDispatch): Promise<void> => {
        dispatch.setProvider(NotificationDeliveryProvider.SmsAndCallGateway);
      },
    );

    expect(lastSendAttributes()["notification.provider"]).toBe(
      "sms_and_call_gateway",
    );
    expect(lastSendAttributes()["notification.on_call_page"]).toBe("true");
  });

  test("sends measured at once are recorded each on its own", async () => {
    await Promise.allSettled([
      NotificationDeliveryMetrics.measureDispatch(
        {
          channel: NotificationDeliveryChannel.Push,
          provider: NotificationDeliveryProvider.Expo,
        },
        async (): Promise<void> => {
          await new Promise<void>((resolve: () => void) => {
            setTimeout(resolve, 5);
          });
        },
      ),
      NotificationDeliveryMetrics.measureDispatch(
        {
          channel: NotificationDeliveryChannel.Push,
          provider: NotificationDeliveryProvider.WebPush,
        },
        async (): Promise<void> => {
          throw new Error("Gone.");
        },
      ),
    ]);

    expect(
      sendCounterCalls
        .map((call: RecordedCall) => {
          return `${call.attributes["notification.provider"]}:${call.attributes["outcome"]}`;
        })
        .sort(),
    ).toEqual(["expo:success", "web_push:failure"]);
  });
});

describe("a message not sent before it reached its sender", () => {
  test("is counted as not sent, by nothing, with no duration", () => {
    NotificationDeliveryMetrics.recordNotSent({
      channel: NotificationDeliveryChannel.Push,
      isOnCallPage: true,
    });

    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "push",
          "notification.provider": "none",
          "notification.provider.config": "global",
          "notification.on_call_page": "true",
          outcome: "not_sent",
        },
      },
    ]);
    expect(sendDurationCalls).toHaveLength(0);
  });

  test("a custom channel's is counted under the channel's id", () => {
    NotificationDeliveryMetrics.recordNotSent({
      channel: NotificationDeliveryChannel.CustomChannel,
      customChannel: { id: CUSTOM_CHANNEL_ID },
    });

    expect(lastSendAttributes()["notification.custom_channel.id"]).toBe(
      CUSTOM_CHANNEL_ID,
    );
    expect(lastSendAttributes()["outcome"]).toBe("not_sent");
  });
});

describe("a record that notifies people", () => {
  test("is counted with its type, who created it and its monitor's type", () => {
    NotificationDeliveryMetrics.recordTrigger({
      type: NotificationTriggerType.Incident,
      source: NotificationTriggerSource.Automatic,
      monitorType: "Incoming Request",
    });

    expect(triggerCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.trigger.type": "incident",
          "notification.trigger.source": "automatic",
          "monitor.type": "Incoming Request",
        },
      },
    ]);
  });

  test("one with no monitor type - a person declared it, an episode - carries none", () => {
    for (const monitorType of [undefined, "", "  "]) {
      expect(
        NotificationDeliveryMetrics.getTriggerAttributes({
          type: NotificationTriggerType.AlertEpisode,
          source: NotificationTriggerSource.Manual,
          monitorType: monitorType,
        }),
      ).toEqual({
        "notification.trigger.type": "alert_episode",
        "notification.trigger.source": "manual",
      });
    }
  });

  test.each([
    {
      row: { triggeredByIncidentId: "i" },
      type: NotificationTriggerType.Incident,
    },
    { row: { triggeredByAlertId: "a" }, type: NotificationTriggerType.Alert },
    {
      row: { triggeredByIncidentEpisodeId: "ie" },
      type: NotificationTriggerType.IncidentEpisode,
    },
    {
      row: { triggeredByAlertEpisodeId: "ae" },
      type: NotificationTriggerType.AlertEpisode,
    },
    { row: {}, type: undefined },
  ])(
    "an on-call row's record type is read from the record it names ($type)",
    (data: {
      row: Record<string, string>;
      type: NotificationTriggerType | undefined;
    }) => {
      expect(NotificationDeliveryMetrics.getTriggerTypeOf(data.row)).toBe(
        data.type,
      );
    },
  );
});

describe("an on-call page's time to send", () => {
  test("is recorded in ms with its channel, its record's type and what it is measured from", () => {
    NotificationDeliveryMetrics.recordTimeToSend({
      channel: NotificationDeliveryChannel.Call,
      triggerType: NotificationTriggerType.Incident,
      pageStart: OnCallPageStart.RecordCreated,
      timeToSendInMs: 4_250,
    });

    expect(timeToSendCalls).toEqual([
      {
        value: 4_250,
        attributes: {
          "notification.channel": "call",
          "notification.page.start": "record_created",
          "notification.trigger.type": "incident",
        },
      },
    ]);
  });

  test("a custom channel's is told apart by its id and name", () => {
    NotificationDeliveryMetrics.recordTimeToSend({
      channel: NotificationDeliveryChannel.CustomChannel,
      customChannel: { id: CUSTOM_CHANNEL_ID, name: "CorpoApp" },
      pageStart: OnCallPageStart.PageStarted,
      timeToSendInMs: 900,
    });

    expect(timeToSendCalls[0]!.attributes).toEqual({
      "notification.channel": "custom_channel",
      "notification.page.start": "page_started",
      "notification.custom_channel.id": CUSTOM_CHANNEL_ID,
      "notification.custom_channel.name": "CorpoApp",
    });
  });

  test("a time below zero - two servers' clocks a little apart - is recorded as zero", () => {
    NotificationDeliveryMetrics.recordTimeToSend({
      channel: NotificationDeliveryChannel.SMS,
      pageStart: OnCallPageStart.RecordCreated,
      timeToSendInMs: -120,
    });

    expect(timeToSendCalls[0]!.value).toBe(0);
  });

  test("a time that is not a number is not recorded", () => {
    for (const timeToSendInMs of [NaN, Infinity, -Infinity]) {
      NotificationDeliveryMetrics.recordTimeToSend({
        channel: NotificationDeliveryChannel.SMS,
        pageStart: OnCallPageStart.RecordCreated,
        timeToSendInMs: timeToSendInMs,
      });
    }

    expect(timeToSendCalls).toHaveLength(0);
  });
});

describe("recording never fails a send", () => {
  test("an instrument that throws is logged and dropped", async () => {
    failInstruments = true;

    expect(() => {
      NotificationDeliveryMetrics.recordNotSent({
        channel: NotificationDeliveryChannel.SMS,
      });
      NotificationDeliveryMetrics.recordTrigger({
        type: NotificationTriggerType.Alert,
        source: NotificationTriggerSource.Automatic,
      });
      NotificationDeliveryMetrics.recordTimeToSend({
        channel: NotificationDeliveryChannel.SMS,
        pageStart: OnCallPageStart.RecordCreated,
        timeToSendInMs: 10,
      });
      NotificationDeliveryMetrics.startDispatch({
        channel: NotificationDeliveryChannel.SMS,
      }).end(NotificationDeliveryOutcome.Success);
      NotificationDeliveryMetrics.recordFailedBeforeSend({
        channel: NotificationDeliveryChannel.Slack,
        destination: NotificationDestination.Channel,
      });
      NotificationDeliveryMetrics.recordDelivery({
        channel: NotificationDeliveryChannel.SMS,
        provider: NotificationDeliveryProvider.Twilio,
        isOnCallPage: true,
        status: NotificationDeliveryStatus.Delivered,
        timeToStatusInMs: 1200,
      });
    }).not.toThrow();

    const value: string = await NotificationDeliveryMetrics.measureDispatch(
      { channel: NotificationDeliveryChannel.SMS },
      async (): Promise<string> => {
        return "sent";
      },
    );

    expect(value).toBe("sent");
    expect(logger.debug).toHaveBeenCalled();
  });

  test("not even when the logger itself throws", () => {
    failInstruments = true;
    (logger.debug as jest.Mock).mockImplementationOnce(() => {
      throw new Error("No logger here either.");
    });

    expect(() => {
      NotificationDeliveryMetrics.recordNotSent({
        channel: NotificationDeliveryChannel.Call,
      });
    }).not.toThrow();
  });

  test("a send whose recording failed still throws its own error, not the metric's", async () => {
    failInstruments = true;
    const error: Error = new Error("Expo refused it.");

    await expect(
      NotificationDeliveryMetrics.measureDispatch(
        { channel: NotificationDeliveryChannel.Push },
        async (): Promise<void> => {
          throw error;
        },
      ),
    ).rejects.toBe(error);
  });
});

describe("one spelling for every channel, provider and outcome", () => {
  const SNAKE_CASE: RegExp = /^[a-z]+(_[a-z]+)*$/;

  test.each([
    ["channel", Object.values(NotificationDeliveryChannel)],
    ["provider", Object.values(NotificationDeliveryProvider)],
    ["outcome", Object.values(NotificationDeliveryOutcome)],
    ["provider config", Object.values(NotificationProviderConfig)],
    ["trigger type", Object.values(NotificationTriggerType)],
    ["trigger source", Object.values(NotificationTriggerSource)],
    ["page start", Object.values(OnCallPageStart)],
  ])(
    "every %s value is lower snake case, and unique",
    (_name: string, values: Array<string>) => {
      for (const value of values) {
        expect(value).toMatch(SNAKE_CASE);
      }

      expect(new Set(values).size).toBe(values.length);
    },
  );

  test("the channels the old metric already used keep their spelling", () => {
    // Anybody charting notification.send.count before keeps their series.
    expect(NotificationDeliveryChannel.Email).toBe("email");
    expect(NotificationDeliveryChannel.SMS).toBe("sms");
    expect(NotificationDeliveryChannel.Call).toBe("call");
    expect(NotificationMetricAttribute.Channel).toBe("notification.channel");
    expect(NotificationMetricAttribute.Outcome).toBe("outcome");
  });

  test("the probe's monitor type attribute is the one triggers use", () => {
    expect(NotificationMetricAttribute.MonitorType).toBe("monitor.type");
  });

  test("every attribute name is namespaced, but outcome, which the old metric used", () => {
    for (const name of Object.values(NotificationMetricAttribute)) {
      if (name === NotificationMetricAttribute.Outcome) {
        continue;
      }

      expect(name).toMatch(/^(notification|monitor)\.[a-z_.]+$/);
    }
  });
});

describe("every on-call channel and every mail transport is counted", () => {
  test("each on-call page channel has a delivery channel of its own", () => {
    const channels: Array<NotificationDeliveryChannel> = [];

    for (const info of ON_CALL_PAGE_CHANNELS) {
      const channel: NotificationDeliveryChannel | null =
        NotificationDeliveryMetrics.getChannelOfOnCallPage(
          (info as OnCallPageChannelInfo).channel,
        );

      expect(channel).not.toBeNull();
      channels.push(channel!);
    }

    expect(new Set(channels).size).toBe(ON_CALL_PAGE_CHANNELS.length);
    expect(channels.length).toBe(Object.values(OnCallPageChannel).length);
  });

  test.each([
    [OnCallPageChannel.Call, "call"],
    [OnCallPageChannel.SMS, "sms"],
    [OnCallPageChannel.WhatsApp, "whatsapp"],
    [OnCallPageChannel.Telegram, "telegram"],
    [OnCallPageChannel.Push, "push"],
    [OnCallPageChannel.Email, "email"],
    [OnCallPageChannel.Slack, "slack"],
    [OnCallPageChannel.MicrosoftTeams, "microsoft_teams"],
    [OnCallPageChannel.Mattermost, "mattermost"],
    [OnCallPageChannel.Webhook, "webhook"],
    [OnCallPageChannel.CustomChannel, "custom_channel"],
  ])("%s is counted as %s", (channel: OnCallPageChannel, expected: string) => {
    expect(NotificationDeliveryMetrics.getChannelOfOnCallPage(channel)).toBe(
      expected,
    );
  });

  test("a value that is not an on-call channel is not counted as one", () => {
    expect(
      NotificationDeliveryMetrics.getChannelOfOnCallPage(
        "Carrier Pigeon" as OnCallPageChannel,
      ),
    ).toBeNull();
  });

  test.each([
    [MailTransportType.SMTP, "smtp"],
    [MailTransportType.MicrosoftGraph, "microsoft_graph"],
    [MailTransportType.AmazonSES, "amazon_ses"],
    [MailTransportType.SendGrid, "sendgrid"],
    [MailTransportType.Mailgun, "mailgun"],
    [MailTransportType.Postmark, "postmark"],
    [MailTransportType.Resend, "resend"],
  ])(
    "an email through %s is counted as %s",
    (transport: MailTransportType, expected: string) => {
      expect(NotificationDeliveryMetrics.getMailProvider(transport)).toBe(
        expected,
      );
    },
  );

  test("every mail transport has a provider", () => {
    for (const transport of Object.values(MailTransportType)) {
      expect(
        Object.values(NotificationDeliveryProvider) as Array<string>,
      ).toContain(NotificationDeliveryMetrics.getMailProvider(transport));
    }
  });

  test("a value that is not a transport is SMTP's, as the mail service reads it", () => {
    expect(
      NotificationDeliveryMetrics.getMailProvider(
        "Fax" as unknown as MailTransportType,
      ),
    ).toBe("smtp");
  });
});

describe("where a chat message went (issue #6645)", () => {
  test("a send that says where it went carries it as notification.destination", () => {
    expect(
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.Slack,
        provider: NotificationDeliveryProvider.Slack,
        providerConfig: NotificationProviderConfig.Project,
        isOnCallPage: false,
        destination: NotificationDestination.Channel,
        outcome: NotificationDeliveryOutcome.Success,
      }),
    ).toEqual({
      "notification.channel": "slack",
      "notification.provider": "slack",
      "notification.provider.config": "project",
      "notification.on_call_page": "false",
      "notification.destination": "channel",
      outcome: "success",
    });
  });

  test("a send that does not - every channel but the three chats - carries no destination at all", () => {
    expect(
      NotificationDeliveryMetrics.getDispatchAttributes({
        channel: NotificationDeliveryChannel.Email,
        provider: NotificationDeliveryProvider.SMTP,
        providerConfig: NotificationProviderConfig.Global,
        isOnCallPage: false,
        outcome: NotificationDeliveryOutcome.Success,
      }),
    ).not.toHaveProperty("notification.destination");
  });

  test("a dispatch started with a destination records it on its send and its duration", () => {
    NotificationDeliveryMetrics.startDispatch({
      channel: NotificationDeliveryChannel.MicrosoftTeams,
      provider: NotificationDeliveryProvider.MicrosoftTeams,
      providerConfig: NotificationProviderConfig.Project,
      destination: NotificationDestination.IncomingWebhook,
    }).end(NotificationDeliveryOutcome.Failure);

    expect(lastSendAttributes()).toEqual({
      "notification.channel": "microsoft_teams",
      "notification.provider": "microsoft_teams",
      "notification.provider.config": "project",
      "notification.on_call_page": "false",
      "notification.destination": "incoming_webhook",
      outcome: "failure",
    });
    expect(sendDurationCalls[0]!.attributes).toEqual(lastSendAttributes());
  });

  test("a message not sent says where it would have gone", () => {
    NotificationDeliveryMetrics.recordNotSent({
      channel: NotificationDeliveryChannel.Mattermost,
      provider: NotificationDeliveryProvider.Mattermost,
      providerConfig: NotificationProviderConfig.Project,
      destination: NotificationDestination.Channel,
    });

    expect(lastSendAttributes()).toMatchObject({
      "notification.destination": "channel",
      outcome: "not_sent",
    });
    expect(sendDurationCalls).toHaveLength(0);
  });
});

describe("a message that failed before it reached its provider", () => {
  test("is counted as a failure, with no duration: the send duration is how long providers take", () => {
    NotificationDeliveryMetrics.recordFailedBeforeSend({
      channel: NotificationDeliveryChannel.Slack,
      provider: NotificationDeliveryProvider.Slack,
      providerConfig: NotificationProviderConfig.Project,
      destination: NotificationDestination.Channel,
    });

    expect(sendCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "slack",
          "notification.provider": "slack",
          "notification.provider.config": "project",
          "notification.on_call_page": "false",
          "notification.destination": "channel",
          outcome: "failure",
        },
      },
    ]);
    expect(sendDurationCalls).toHaveLength(0);
  });

  test("with nothing more said: by no provider, on the server's own account, as no page", () => {
    NotificationDeliveryMetrics.recordFailedBeforeSend({
      channel: NotificationDeliveryChannel.MicrosoftTeams,
    });

    expect(lastSendAttributes()).toEqual({
      "notification.channel": "microsoft_teams",
      "notification.provider": "none",
      "notification.provider.config": "global",
      "notification.on_call_page": "false",
      outcome: "failure",
    });
  });

  test("never touches the final-status metrics", () => {
    NotificationDeliveryMetrics.recordFailedBeforeSend({
      channel: NotificationDeliveryChannel.Slack,
    });

    expect(deliveryCounterCalls).toHaveLength(0);
    expect(deliveryDurationCalls).toHaveLength(0);
  });
});

describe("how a message a provider accepted ended (issue #6648)", () => {
  test("is counted once with its channel, provider, account, whether it was a page, and its status as outcome", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.SMS,
      provider: NotificationDeliveryProvider.Twilio,
      providerConfig: NotificationProviderConfig.Project,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Undelivered,
      timeToStatusInMs: 4200,
    });

    expect(deliveryCounterCalls).toEqual([
      {
        value: 1,
        attributes: {
          "notification.channel": "sms",
          "notification.provider": "twilio",
          "notification.provider.config": "project",
          "notification.on_call_page": "true",
          outcome: "undelivered",
        },
      },
    ]);
    expect(deliveryDurationCalls).toEqual([
      { value: 4200, attributes: deliveryCounterCalls[0]!.attributes },
    ]);
  });

  test("never touches the send metrics", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.Call,
      provider: NotificationDeliveryProvider.Twilio,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Answered,
      timeToStatusInMs: 12000,
    });

    expect(sendCounterCalls).toHaveLength(0);
    expect(sendDurationCalls).toHaveLength(0);
    expect(triggerCounterCalls).toHaveLength(0);
    expect(timeToSendCalls).toHaveLength(0);
  });

  test("with no account said: the server's own", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.Push,
      provider: NotificationDeliveryProvider.Expo,
      isOnCallPage: false,
      status: NotificationDeliveryStatus.Delivered,
    });

    expect(deliveryCounterCalls[0]!.attributes).toEqual({
      "notification.channel": "push",
      "notification.provider": "expo",
      "notification.provider.config": "global",
      "notification.on_call_page": "false",
      outcome: "delivered",
    });
  });

  test("with no time known - a push's receipt says none - it is counted, not timed", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.Push,
      provider: NotificationDeliveryProvider.PushRelay,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Failed,
    });

    expect(deliveryCounterCalls).toHaveLength(1);
    expect(deliveryDurationCalls).toHaveLength(0);
  });

  test.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "a time of %s is not a time: counted, not timed",
    (time: number) => {
      NotificationDeliveryMetrics.recordDelivery({
        channel: NotificationDeliveryChannel.WhatsApp,
        provider: NotificationDeliveryProvider.MetaWhatsApp,
        isOnCallPage: false,
        status: NotificationDeliveryStatus.Delivered,
        timeToStatusInMs: time,
      });

      expect(deliveryCounterCalls).toHaveLength(1);
      expect(deliveryDurationCalls).toHaveLength(0);
    },
  );

  test("a time below zero - two servers' clocks a little apart - is recorded as zero", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.SMS,
      provider: NotificationDeliveryProvider.Twilio,
      isOnCallPage: false,
      status: NotificationDeliveryStatus.Delivered,
      timeToStatusInMs: -350,
    });

    expect(deliveryDurationCalls[0]!.value).toBe(0);
  });

  test("a time of zero is a time", () => {
    NotificationDeliveryMetrics.recordDelivery({
      channel: NotificationDeliveryChannel.Call,
      provider: NotificationDeliveryProvider.Twilio,
      isOnCallPage: true,
      status: NotificationDeliveryStatus.Answered,
      timeToStatusInMs: 0,
    });

    expect(deliveryDurationCalls).toEqual([
      { value: 0, attributes: deliveryCounterCalls[0]!.attributes },
    ]);
  });

  test("an instrument that throws is logged and dropped - a callback is never failed by its metric", () => {
    failInstruments = true;

    expect(() => {
      NotificationDeliveryMetrics.recordDelivery({
        channel: NotificationDeliveryChannel.SMS,
        provider: NotificationDeliveryProvider.Twilio,
        isOnCallPage: true,
        status: NotificationDeliveryStatus.Delivered,
        timeToStatusInMs: 900,
      });
    }).not.toThrow();

    expect(logger.debug).toHaveBeenCalled();
  });

  test("its attributes, on their own", () => {
    expect(
      NotificationDeliveryMetrics.getDeliveryAttributes({
        channel: NotificationDeliveryChannel.Call,
        provider: NotificationDeliveryProvider.Twilio,
        isOnCallPage: false,
        status: NotificationDeliveryStatus.NotAnswered,
      }),
    ).toEqual({
      "notification.channel": "call",
      "notification.provider": "twilio",
      "notification.provider.config": "global",
      "notification.on_call_page": "false",
      outcome: "not_answered",
    });
  });
});

describe("how long ago a message's log was written", () => {
  const NOW: Date = new Date("2026-11-10T12:00:00.000Z");

  test("is the time from the log to now", () => {
    expect(
      NotificationDeliveryMetrics.getMillisecondsSince(
        new Date("2026-11-10T11:59:57.500Z"),
        NOW,
      ),
    ).toBe(2500);
  });

  test("a log written after now - two clocks - is below zero, for recordDelivery to make zero", () => {
    expect(
      NotificationDeliveryMetrics.getMillisecondsSince(
        new Date("2026-11-10T12:00:01.000Z"),
        NOW,
      ),
    ).toBe(-1000);
  });

  test("a time read back as text is read as a time", () => {
    expect(
      NotificationDeliveryMetrics.getMillisecondsSince(
        "2026-11-10T11:59:00.000Z" as unknown as Date,
        NOW,
      ),
    ).toBe(60000);
  });

  test.each([
    ["no time", undefined],
    ["null", null],
    ["a time that is not one", new Date("not a date")],
    ["text that is not a time", "yesterday-ish" as unknown as Date],
  ])("%s: not known", (_name: string, writtenAt: Date | null | undefined) => {
    expect(
      NotificationDeliveryMetrics.getMillisecondsSince(writtenAt, NOW),
    ).toBeUndefined();
  });

  test("is measured to the clock's now, unless told otherwise", () => {
    const since: number | undefined =
      NotificationDeliveryMetrics.getMillisecondsSince(
        new Date(Date.now() - 5000),
      );

    expect(since).toBeGreaterThanOrEqual(5000);
    expect(since).toBeLessThan(5000 + 60000);
  });
});

describe("the final status a log's status is", () => {
  const SMS_FINAL: Record<string, NotificationDeliveryStatus> = {
    [SmsStatus.Delivered]: NotificationDeliveryStatus.Delivered,
    [SmsStatus.Undelivered]: NotificationDeliveryStatus.Undelivered,
    [SmsStatus.Failed]: NotificationDeliveryStatus.Failed,
  };

  test.each(Object.values(SmsStatus))("an SMS at %s", (status: SmsStatus) => {
    expect(NotificationDeliveryMetrics.getDeliveryStatusOfSms(status)).toBe(
      SMS_FINAL[status] ?? null,
    );
  });

  test("an SMS with no status has none", () => {
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfSms(undefined),
    ).toBeNull();
    expect(NotificationDeliveryMetrics.getDeliveryStatusOfSms(null)).toBeNull();
  });

  test("an SMS that could not be sent - an error, too little balance - is not a status Twilio reported", () => {
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfSms(SmsStatus.Error),
    ).toBeNull();
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfSms(SmsStatus.LowBalance),
    ).toBeNull();
  });

  const WHATSAPP_FINAL: Record<string, NotificationDeliveryStatus> = {
    [WhatsAppStatus.Delivered]: NotificationDeliveryStatus.Delivered,
    [WhatsAppStatus.Read]: NotificationDeliveryStatus.Delivered,
    [WhatsAppStatus.Failed]: NotificationDeliveryStatus.Failed,
  };

  test.each(Object.values(WhatsAppStatus))(
    "a WhatsApp message at %s",
    (status: WhatsAppStatus) => {
      expect(
        NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(status),
      ).toBe(WHATSAPP_FINAL[status] ?? null);
    },
  );

  test("a WhatsApp message read was delivered: it is counted as delivered", () => {
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(
        WhatsAppStatus.Read,
      ),
    ).toBe(NotificationDeliveryStatus.Delivered);
  });

  test("a WhatsApp message with no status has none", () => {
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(undefined),
    ).toBeNull();
    expect(
      NotificationDeliveryMetrics.getDeliveryStatusOfWhatsApp(null),
    ).toBeNull();
  });
});

/*
 * The values the docs (issue #6644) and anybody's dashboards and SLOs are
 * written against: each one spelled once, here.
 */
describe("the spelling of the destination and the final statuses", () => {
  const SNAKE_CASE: RegExp = /^[a-z]+(_[a-z]+)*$/;

  test("the destination attribute's name", () => {
    expect(NotificationMetricAttribute.Destination).toBe(
      "notification.destination",
    );
  });

  test("the destinations", () => {
    expect(Object.values(NotificationDestination).sort()).toEqual([
      "channel",
      "direct_message",
      "incoming_webhook",
    ]);
  });

  test("the final statuses", () => {
    expect(Object.values(NotificationDeliveryStatus).sort()).toEqual([
      "answered",
      "delivered",
      "failed",
      "not_answered",
      "undelivered",
    ]);
  });

  test.each([
    ["destination", Object.values(NotificationDestination)],
    ["final status", Object.values(NotificationDeliveryStatus)],
  ])(
    "every %s value is lower snake case, and unique",
    (_name: string, values: Array<string>) => {
      for (const value of values) {
        expect(value).toMatch(SNAKE_CASE);
      }

      expect(new Set(values).size).toBe(values.length);
    },
  );

  test("no final status is spelled as a send's outcome: the two metrics' outcomes are told apart", () => {
    for (const status of Object.values(NotificationDeliveryStatus)) {
      expect(
        Object.values(NotificationDeliveryOutcome) as Array<string>,
      ).not.toContain(status);
    }
  });
});
