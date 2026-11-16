import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  NotificationSettingsWords,
  OfferedChannel,
  TAB_SUMMARY,
  TAB_SUMMARY_NONE,
  TabSummaryFacts,
  describeTabSummary,
  getTabSummaryFacts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationSettingsWords";
import {
  ChannelReach,
  NotificationChannelDefinition,
  NotificationChannelKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationChannelReadiness";
import {
  getShownMatrixChannels,
  isOnForEveryEvent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/NotificationMatrix";
import { getChannelsToSetUp } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/ChannelsNotSetUp";
import { getOfferedChannels } from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationSettings";
import { RowsByEvent } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationSettings/useNotificationSettingRows";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import IconProp from "../../../Types/Icon/IconProp";
import { Blue500 } from "../../../Types/BrandColors";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";
import { Translator, createTranslator } from "../../../Types/Translator";

/*
 * The words and the rules behind Notification Settings' new parts (#8887),
 * without a page: what a tab adds up to and how it is said, which columns
 * a card shows, when "All events" is on, and which channels the page
 * offers to set up.
 */

const E: typeof NotificationSettingEventType = NotificationSettingEventType;

function channel(
  key: NotificationChannelKey,
  label: string,
  reach: ChannelReach = ChannelReach.Ready,
): OfferedChannel {
  const definition: NotificationChannelDefinition = {
    key: key,
    label: label,
    icon: IconProp.Email,
    color: Blue500,
  };

  return { definition: definition, reach: reach };
}

function rowsOf(
  entries: Array<
    [
      NotificationSettingEventType,
      Partial<Record<NotificationChannelKey, boolean>>,
    ]
  >,
): RowsByEvent {
  const map: Map<NotificationSettingEventType, UserNotificationSetting> =
    new Map();

  for (const [eventType, channels] of entries) {
    const row: UserNotificationSetting = new UserNotificationSetting();
    row.eventType = eventType;

    for (const [key, value] of Object.entries(channels)) {
      (row as unknown as Record<string, boolean>)[key] = Boolean(value);
    }

    map.set(eventType, row);
  }

  return map;
}

const EMAIL: OfferedChannel = channel("alertByEmail", "Email");
const SMS: OfferedChannel = channel("alertBySMS", "SMS");
const SLACK: OfferedChannel = channel("alertBySlack", "Slack");

const EVENTS: Array<NotificationSettingEventType> = [
  E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
  E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
];

const ENGLISH: Translator = createTranslator(undefined, "en");

describe("what a tab adds up to", () => {
  test("an event reaches you when a channel that can reach you is on for it", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: EVENTS,
      rowsByEvent: rowsOf([
        [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertByEmail: true }],
        [
          E.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
          { alertByEmail: false, alertBySlack: true },
        ],
        [
          E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
          { alertByEmail: false },
        ],
      ]),
      channels: [EMAIL, SMS, SLACK],
    });

    expect(facts.reaching).toBe(2);
    expect(facts.total).toBe(3);
    expect(
      facts.channels.map(
        (definition: NotificationChannelDefinition): string => {
          return definition.label;
        },
      ),
    ).toEqual(["Email", "Slack"]);
  });

  test("an event with no row is every channel off", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: EVENTS,
      rowsByEvent: new Map(),
      channels: [EMAIL],
    });

    expect(facts).toEqual({ reaching: 0, total: 3, channels: [] });
  });

  test("a channel that cannot reach you counts for nothing, and is not named", () => {
    for (const reach of [ChannelReach.NotSetUp, ChannelReach.TurnedOff]) {
      const facts: TabSummaryFacts = getTabSummaryFacts({
        eventTypes: EVENTS,
        rowsByEvent: rowsOf([
          [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertBySMS: true }],
        ]),
        channels: [EMAIL, channel("alertBySMS", "SMS", reach)],
      });

      expect(facts.reaching).toBe(0);
      expect(facts.channels).toEqual([]);
    }
  });

  test("a channel nobody could check counts, as it is offered", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: EVENTS,
      rowsByEvent: rowsOf([
        [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertBySMS: true }],
      ]),
      channels: [channel("alertBySMS", "SMS", ChannelReach.Unknown)],
    });

    expect(facts.reaching).toBe(1);
  });

  test("a channel the page does not offer (a workspace not connected) is not counted", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: EVENTS,
      rowsByEvent: rowsOf([
        [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertBySlack: true }],
      ]),
      channels: [EMAIL],
    });

    expect(facts.reaching).toBe(0);
  });

  test("events of other tabs are not counted", () => {
    const facts: TabSummaryFacts = getTabSummaryFacts({
      eventTypes: [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION],
      rowsByEvent: rowsOf([
        [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertByEmail: true }],
        [E.SEND_ALERT_CREATED_OWNER_NOTIFICATION, { alertByEmail: true }],
      ]),
      channels: [EMAIL],
    });

    expect(facts).toEqual({
      reaching: 1,
      total: 1,
      channels: [EMAIL.definition],
    });
  });
});

describe("how a tab's summary is said", () => {
  test("none", () => {
    expect(
      describeTabSummary({ reaching: 0, total: 12, channels: [] }, ENGLISH),
    ).toBe("You hear about none of the events on this tab.");
  });

  test("some, by one channel, by two, by three", () => {
    expect(
      describeTabSummary(
        { reaching: 7, total: 12, channels: [EMAIL.definition] },
        ENGLISH,
      ),
    ).toBe("You hear about 7 of 12 events on this tab, by Email.");
    expect(
      describeTabSummary(
        {
          reaching: 7,
          total: 12,
          channels: [EMAIL.definition, SLACK.definition],
        },
        ENGLISH,
      ),
    ).toBe("You hear about 7 of 12 events on this tab, by Email and Slack.");
    expect(
      describeTabSummary(
        {
          reaching: 12,
          total: 12,
          channels: [EMAIL.definition, SMS.definition, SLACK.definition],
        },
        ENGLISH,
      ),
    ).toBe(
      "You hear about 12 of 12 events on this tab, by Email, SMS and Slack.",
    );
  });

  test("its noun agrees with the number of events, the count it is said by", () => {
    expect(
      describeTabSummary(
        { reaching: 1, total: 1, channels: [EMAIL.definition] },
        ENGLISH,
      ),
    ).toBe("You hear about 1 of 1 event on this tab, by Email.");
    expect(TAB_SUMMARY.other).toContain("{{on}} of {{count}} events");
    expect(TAB_SUMMARY.one).toContain("{{on}} of {{count}} event ");
  });

  test("a channel's name is its word: phone call and push read Call and Push in English", () => {
    expect(
      describeTabSummary(
        {
          reaching: 2,
          total: 5,
          channels: [
            {
              ...channel("alertByCall", "Call").definition,
              word: "Call (phone call)",
            },
            {
              ...channel("alertByPush", "Push").definition,
              word: "Push (push notification)",
            },
          ],
        },
        ENGLISH,
      ),
    ).toBe("You hear about 2 of 5 events on this tab, by Call and Push.");
  });

  test("in Persian, both counts in Persian digits and the phone call is a phone call", () => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/fa.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;
    const persian: Translator = createTranslator(
      (text: string): string | undefined => {
        return locale[text];
      },
      "fa",
    );
    const said: string = describeTabSummary(
      {
        reaching: 7,
        total: 12,
        channels: [
          {
            ...channel("alertByCall", "Call").definition,
            word: "Call (phone call)",
          },
        ],
      },
      persian,
    );

    expect(said).toContain("۷");
    expect(said).toContain("۱۲");
    expect(said).not.toMatch(/[0-9]/);
    expect(said).toContain(locale["Call (phone call)"]!);
    expect(persian.translateText(TAB_SUMMARY_NONE)).toBe(
      locale[TAB_SUMMARY_NONE],
    );
  });
});

describe("the columns a card shows", () => {
  const PUSH_NOT_SET_UP: OfferedChannel = channel(
    "alertByPush",
    "Push",
    ChannelReach.NotSetUp,
  );
  const SMS_TURNED_OFF: OfferedChannel = channel(
    "alertBySMS",
    "SMS",
    ChannelReach.TurnedOff,
  );

  test("every channel that can reach you, in the page's order", () => {
    expect(
      getShownMatrixChannels({
        channels: [
          EMAIL,
          channel("alertByWebhook", "Webhook", ChannelReach.Unknown),
          SLACK,
        ],
        eventTypes: EVENTS,
        rowsByEvent: new Map(),
      }).map((shown: OfferedChannel): string => {
        return shown.definition.label;
      }),
    ).toEqual(["Email", "Webhook", "Slack"]);
  });

  test("one that cannot only while a switch of the card is on for it", () => {
    const shown: (rows: RowsByEvent) => Array<string> = (
      rows: RowsByEvent,
    ): Array<string> => {
      return getShownMatrixChannels({
        channels: [EMAIL, SMS_TURNED_OFF, PUSH_NOT_SET_UP],
        eventTypes: EVENTS,
        rowsByEvent: rows,
      }).map((offered: OfferedChannel): string => {
        return offered.definition.label;
      });
    };

    expect(shown(new Map())).toEqual(["Email"]);
    expect(
      shown(
        rowsOf([
          [
            E.SEND_INCIDENT_NOTE_POSTED_OWNER_NOTIFICATION,
            { alertByPush: true },
          ],
        ]),
      ),
    ).toEqual(["Email", "Push"]);
    expect(
      shown(
        rowsOf([
          [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertBySMS: true }],
        ]),
      ),
    ).toEqual(["Email", "SMS"]);
    // A switch on another card's event does not bring the column here.
    expect(
      shown(
        rowsOf([
          [E.SEND_ALERT_CREATED_OWNER_NOTIFICATION, { alertByPush: true }],
        ]),
      ),
    ).toEqual(["Email"]);
  });

  test("a column already shown stays, though its last switch was turned off", () => {
    expect(
      getShownMatrixChannels({
        channels: [EMAIL, PUSH_NOT_SET_UP],
        eventTypes: EVENTS,
        rowsByEvent: new Map(),
        alreadyShown: new Set<NotificationChannelKey>(["alertByPush"]),
      }).map((offered: OfferedChannel): string => {
        return offered.definition.label;
      }),
    ).toEqual(["Email", "Push"]);
  });
});

describe("All events", () => {
  test("is on only while every event of the card has the channel on", () => {
    const allOn: RowsByEvent = rowsOf(
      EVENTS.map(
        (
          eventType: NotificationSettingEventType,
        ): [
          NotificationSettingEventType,
          Partial<Record<NotificationChannelKey, boolean>>,
        ] => {
          return [eventType, { alertByEmail: true }];
        },
      ),
    );

    expect(
      isOnForEveryEvent({
        eventTypes: EVENTS,
        rowsByEvent: allOn,
        channel: "alertByEmail",
      }),
    ).toBe(true);
    expect(
      isOnForEveryEvent({
        eventTypes: EVENTS,
        rowsByEvent: allOn,
        channel: "alertBySMS",
      }),
    ).toBe(false);

    const oneMissing: RowsByEvent = rowsOf([
      [E.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION, { alertByEmail: true }],
      [
        E.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION,
        { alertByEmail: true },
      ],
    ]);

    expect(
      isOnForEveryEvent({
        eventTypes: EVENTS,
        rowsByEvent: oneMissing,
        channel: "alertByEmail",
      }),
    ).toBe(false);
  });

  test("a card with no events is never all on", () => {
    expect(
      isOnForEveryEvent({
        eventTypes: [],
        rowsByEvent: new Map(),
        channel: "alertByEmail",
      }),
    ).toBe(false);
  });
});

describe("the channels offered to set up", () => {
  test("only those with no verified method of yours, and somewhere to set them up", () => {
    expect(
      getChannelsToSetUp([
        EMAIL,
        channel("alertBySMS", "SMS", ChannelReach.NotSetUp),
        channel("alertByCall", "Call", ChannelReach.TurnedOff),
        channel("alertByPush", "Push", ChannelReach.Unknown),
        channel("alertByWebhook", "Webhook", ChannelReach.NotSetUp),
        channel(
          "alertByCustomChannel",
          "Custom Channels",
          ChannelReach.NotSetUp,
        ),
      ]).map((offered: OfferedChannel): string => {
        return offered.definition.label;
      }),
    ).toEqual(["SMS", "Webhook"]);
  });
});

describe("the channels the page offers", () => {
  test("each with whether it can reach you, workspaces only where connected", () => {
    const offered: Array<OfferedChannel> = getOfferedChannels({
      offeredWorkspaces: [WorkspaceType.Slack],
      hasCustomChannels: false,
      readiness: {
        verifiedMethodCounts: {
          alertByEmail: 1,
          alertBySMS: 0,
          alertByCall: 1,
          alertByPush: 1,
          alertByWhatsApp: 0,
          alertByTelegram: 0,
          alertBySlack: 1,
          alertByWebhook: 0,
        },
        projectChannels: {
          [ProjectNotificationChannel.SMS]: true,
          [ProjectNotificationChannel.Call]: false,
          [ProjectNotificationChannel.WhatsApp]: true,
          [ProjectNotificationChannel.Telegram]: true,
        },
        isPushTurnedOff: false,
      },
    });

    expect(
      offered.map((each: OfferedChannel): [string, ChannelReach] => {
        return [each.definition.label, each.reach];
      }),
    ).toEqual([
      ["Email", ChannelReach.Ready],
      ["SMS", ChannelReach.NotSetUp],
      ["Call", ChannelReach.TurnedOff],
      ["Push", ChannelReach.Ready],
      ["WhatsApp", ChannelReach.NotSetUp],
      ["Telegram", ChannelReach.NotSetUp],
      ["Slack", ChannelReach.Ready],
      ["Webhook", ChannelReach.NotSetUp],
    ]);
  });

  test("phone call and push carry the words that name their meaning", () => {
    const offered: Array<OfferedChannel> = getOfferedChannels({
      offeredWorkspaces: [],
      hasCustomChannels: true,
      readiness: {
        verifiedMethodCounts: {},
        projectChannels: null,
        isPushTurnedOff: null,
      },
    });
    const byLabel: (label: string) => NotificationChannelDefinition = (
      label: string,
    ): NotificationChannelDefinition => {
      return offered.find((each: OfferedChannel): boolean => {
        return each.definition.label === label;
      })!.definition;
    };

    expect(byLabel("Call").word).toBe("Call (phone call)");
    expect(byLabel("Push").word).toBe("Push (push notification)");
    expect(byLabel("Email").word).toBeUndefined();
    // Custom channels are the server's, Ready whatever is known.
    expect(
      offered.find((each: OfferedChannel): boolean => {
        return each.definition.key === "alertByCustomChannel";
      })!.reach,
    ).toBe(ChannelReach.Ready);
  });
});

describe("the page's words", () => {
  test("are each a whole sentence or name, in en.json as themselves", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(
        path.resolve(
          __dirname,
          "../../../../App/FeatureSet/Dashboard/src/Locales/en.json",
        ),
        "utf8",
      ),
    ) as Record<string, string>;

    for (const words of [
      ...Object.values(NotificationSettingsWords),
      TAB_SUMMARY.other,
      TAB_SUMMARY_NONE,
      "Call (phone call)",
      "Push (push notification)",
    ]) {
      expect({ words, english: english[words] }).toEqual({
        words,
        english: words,
      });
    }

    expect(english[`${TAB_SUMMARY.other}_one`]).toBe(TAB_SUMMARY.one);
  });
});
