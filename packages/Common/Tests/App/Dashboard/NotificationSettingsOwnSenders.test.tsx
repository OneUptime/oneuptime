import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Project Settings -> Notifications -> Notification Settings: the balance
 * SMS, calls, WhatsApp and Telegram are paid from (billing only), the
 * channel switches, Auto Recharge (billing only) - and, folded under More
 * settings, the project's own mail servers (Custom SMTP Configs) and Twilio
 * accounts (Twilio Config).
 *
 * "Please audit the entire project for advanced features just like these
 * and move them to More as well, so it is hidden by default and it doesn't
 * cause frustration and decision paralysis to users." - the maintainer.
 * Most projects never add a mail server or a Twilio account of their own:
 * OneUptime sends their email, SMS and calls. Both tables were cards of
 * their own under the switches; now:
 *
 *   - they are in the page's More settings, everything else above it;
 *   - folded, its header names the two, each with how many configs it
 *     holds while it holds any;
 *   - a link to #custom-smtp-configs or #twilio-config (an incoming call
 *     policy's "create one", a status page's mail server, Search) opens it
 *     there.
 *
 * Whether on-call calls tell a voicemail from a person answering (#6594) is
 * a switch folded there too, beside how members are paged by default: on for
 * every project, so it is named, and set - Off - only once switched off.
 *
 * The tables and cards are recorded rather than drawn (each has a suite of
 * its own: CustomSmtpConfigForm, TwilioConfigUse and the balance pages'):
 * what matters is where the page puts them, what it hands them, and what
 * the folded header says.
 */

type Recorded = { name: string; props: Record<string, unknown> };

const recorded: Array<Recorded> = [];

(
  globalThis as unknown as { __ownSendersRecorded: Array<Recorded> }
).__ownSendersRecorded = recorded;

type Recorder = (
  name: string,
) => (props: Record<string, unknown>) => ReactElement;

const mockRecorder: Recorder = (name: string) => {
  return (props: Record<string, unknown>): ReactElement => {
    (
      globalThis as unknown as { __ownSendersRecorded: Array<Recorded> }
    ).__ownSendersRecorded.push({ name: name, props: props });

    const react: typeof React = jest.requireActual("react") as typeof React;

    return react.createElement("div", {
      "data-testid": "recorded-card",
      "data-card":
        name === "card-model-detail"
          ? `${name}: ${String(props["name"])}`
          : name,
    });
  };
};

let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomSMTP/CustomSMTPTable",
  () => {
    return { __esModule: true, default: mockRecorder("custom-smtp-table") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable",
  () => {
    return { __esModule: true, default: mockRecorder("twilio-config-table") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCard",
  () => {
    return { __esModule: true, default: mockRecorder("channels-card") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/AutoRechargeFailedNotice",
  () => {
    return { __esModule: true, default: mockRecorder("auto-recharge-notice") };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ProjectBalance/AutoRechargeCard",
  () => {
    return { __esModule: true, default: mockRecorder("auto-recharge-card") };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return { __esModule: true, default: mockRecorder("card-model-detail") };
});

// How members are paged by default (#7449): ProjectPagingDefaults tests them.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/DefaultPagingLadderCard",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("default-ladder-card"),
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/PhoneForOnCallCard",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("phone-for-on-call-card"),
    };
  },
);

// Voicemail on on-call calls (#6594): VoicemailDetection tests it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VoicemailDetectionCard",
  () => {
    return {
      __esModule: true,
      default: mockRecorder("voicemail-detection-card"),
    };
  },
);

import NotificationSettings, {
  NOTIFICATION_SETTINGS_MORE_DESCRIPTION,
  NOTIFICATION_SETTINGS_MORE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/NotificationSettings";
import {
  CUSTOM_SMTP_CONFIGS_PLACE,
  CUSTOM_SMTP_CONFIGS_TITLE,
  getOwnSendersFoldedItems,
  TWILIO_CONFIG_PLACE,
  TWILIO_CONFIG_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/OwnSendersFold";
import {
  DEFAULT_LADDER_PLACE,
  DEFAULT_LADDER_TITLE,
  PHONE_FOR_ON_CALL_PLACE,
  PHONE_FOR_ON_CALL_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationRule/PagingLadder/ProjectPagingDefaultsWords";
import {
  VOICEMAIL_DETECTION_PLACE,
  VOICEMAIL_DETECTION_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VoicemailDetectionWords";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  recorded.length = 0;
  billingEnabledForTest = false;

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState(null, "", "#");
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <NotificationSettings
          pageRoute={RouteMap[PageMap.SETTINGS_NOTIFICATION_SETTINGS] as Route}
          currentProject={null}
          hasPaymentMethod={true}
        />
      </MemoryRouter>,
    );
  });
}

function fold(): HTMLElement {
  return screen.getByTestId(NOTIFICATION_SETTINGS_MORE_TEST_ID);
}

function header(): HTMLElement {
  return within(fold()).getByRole("button", { name: "More settings" });
}

function cardsIn(container: HTMLElement): Array<string | null> {
  return within(container)
    .getAllByTestId("recorded-card")
    .map((element: HTMLElement): string | null => {
      return element.getAttribute("data-card");
    });
}

function latestPropsOf(name: string): Record<string, unknown> {
  const all: Array<Recorded> = recorded.filter((entry: Recorded): boolean => {
    return entry.name === name;
  });

  expect([name, all.length > 0]).toEqual([name, true]);

  return all[all.length - 1]!.props;
}

// How many configs a table lists, told to the page as the table would.
async function listed(name: string, count: number): Promise<void> {
  const onCountChange: (count: number) => void = latestPropsOf(name)[
    "onCountChange"
  ] as (count: number) => void;

  await act(async () => {
    onCountChange(count);
  });
}

describe.each([false, true])(
  "Notification Settings, billing on: %s",
  (isBillingOn: boolean) => {
    beforeEach(() => {
      billingEnabledForTest = isBillingOn;
    });

    test("the channel switches stay on the page; how members are paged by default, then the two tables, wait in More settings, last", async () => {
      await renderPage();

      expect(cardsIn(fold())).toEqual([
        "default-ladder-card",
        "phone-for-on-call-card",
        "voicemail-detection-card",
        "custom-smtp-table",
        "twilio-config-table",
      ]);

      // Everything else is above the fold, the channel switches among them.
      const outside: Array<string | null> = cardsIn(document.body).filter(
        (card: string | null): boolean => {
          return !cardsIn(fold()).includes(card);
        },
      );

      expect(outside).toContain("channels-card");

      if (isBillingOn) {
        expect(outside).toEqual(
          expect.arrayContaining([
            "auto-recharge-notice",
            "card-model-detail: Current Balance",
            "auto-recharge-card",
          ]),
        );
      }

      // The fold is the last thing on the page.
      const all: Array<HTMLElement> = screen.getAllByTestId("recorded-card");

      expect(fold()).toContainElement(all[all.length - 1]!);
    });

    test("folded, it names the default ladder, the phone ask, voicemail and the two tables, and nothing is set before they say so", async () => {
      await renderPage();

      expect(header()).toHaveAttribute("aria-expanded", "false");
      expect(listedNames(header())).toEqual([
        DEFAULT_LADDER_TITLE,
        PHONE_FOR_ON_CALL_TITLE,
        VOICEMAIL_DETECTION_TITLE,
        CUSTOM_SMTP_CONFIGS_TITLE,
        TWILIO_CONFIG_TITLE,
      ]);
      expect(setChips(fold())).toEqual([]);

      fireEvent.click(header());

      expect(header()).toHaveAttribute("aria-expanded", "true");
      expect(fold()).toHaveTextContent(NOTIFICATION_SETTINGS_MORE_DESCRIPTION);
    });

    test("a default ladder says how many steps it has, and the phone ask On, folded (#7449)", async () => {
      await renderPage();

      const onStepCountChange: (count: number) => void = latestPropsOf(
        "default-ladder-card",
      )["onStepCountChange"] as (count: number) => void;
      const onChange: (isOn: boolean) => void = latestPropsOf(
        "phone-for-on-call-card",
      )["onChange"] as (isOn: boolean) => void;

      await act(async () => {
        onStepCountChange(3);
        onChange(true);
      });

      expect(setChips(fold())).toEqual([
        `${DEFAULT_LADDER_TITLE}: 3`,
        `${PHONE_FOR_ON_CALL_TITLE}: On`,
      ]);
      // Both cards are this project's.
      expect(String(latestPropsOf("default-ladder-card")["projectId"])).toBe(
        PROJECT_ID,
      );
      expect(header()).toHaveAttribute("aria-expanded", "false");
    });

    test("voicemail detection, on for every project, is set - Off - only once switched off (#6594)", async () => {
      await renderPage();

      const onChange: (isOn: boolean) => void = latestPropsOf(
        "voicemail-detection-card",
      )["onChange"] as (isOn: boolean) => void;

      // The project's own switch.
      expect(
        String(latestPropsOf("voicemail-detection-card")["projectId"]),
      ).toBe(PROJECT_ID);

      await act(async () => {
        onChange(true);
      });

      expect(setChips(fold())).toEqual([]);

      await act(async () => {
        onChange(false);
      });

      expect(setChips(fold())).toEqual([`${VOICEMAIL_DETECTION_TITLE}: Off`]);
      expect(header()).toHaveAttribute("aria-expanded", "false");

      await act(async () => {
        onChange(true);
      });

      expect(setChips(fold())).toEqual([]);
    });

    test("each table that lists a config says how many, folded", async () => {
      await renderPage();

      await listed("custom-smtp-table", 2);

      expect(setChips(fold())).toEqual([`${CUSTOM_SMTP_CONFIGS_TITLE}: 2`]);

      await listed("twilio-config-table", 1);

      expect(setChips(fold())).toEqual([
        `${CUSTOM_SMTP_CONFIGS_TITLE}: 2`,
        `${TWILIO_CONFIG_TITLE}: 1`,
      ]);

      // The last one deleted: named, no longer set.
      await listed("custom-smtp-table", 0);

      expect(setChips(fold())).toEqual([`${TWILIO_CONFIG_TITLE}: 1`]);
      // Saying so never opens it.
      expect(header()).toHaveAttribute("aria-expanded", "false");
    });

    test.each([
      [DEFAULT_LADDER_PLACE, "default-ladder-for-new-members"],
      [PHONE_FOR_ON_CALL_PLACE, "phone-for-people-on-call"],
      [VOICEMAIL_DETECTION_PLACE, "voicemail-on-on-call-calls"],
      [CUSTOM_SMTP_CONFIGS_PLACE, "custom-smtp-configs"],
      [TWILIO_CONFIG_PLACE, "twilio-config"],
    ])("opened at #%s, it opens there", async (place: string, name: string) => {
      expect(place).toBe(name);

      window.history.replaceState(null, "", `#${place}`);

      await renderPage();

      expect(header()).toHaveAttribute("aria-expanded", "true");
    });

    test("opened at the channel switches, it stays folded", async () => {
      window.history.replaceState(null, "", "#notification-channels");

      await renderPage();

      expect(header()).toHaveAttribute("aria-expanded", "false");
    });
  },
);

describe("what the folded header says", () => {
  test("each table by its title, at its title's place, set with how many configs it lists", () => {
    const items: Array<FoldedSectionItem> = getOwnSendersFoldedItems({
      smtpConfigCount: 3,
      twilioConfigCount: 0,
    });

    expect(items).toEqual([
      {
        key: "custom-smtp-configs",
        title: CUSTOM_SMTP_CONFIGS_TITLE,
        isSet: true,
        value: "3",
      },
      {
        key: "twilio-config",
        title: TWILIO_CONFIG_TITLE,
        isSet: false,
      },
    ]);
  });

  test("the titles are the tables' own", () => {
    expect([CUSTOM_SMTP_CONFIGS_TITLE, TWILIO_CONFIG_TITLE]).toEqual([
      "Custom SMTP Configs",
      "Twilio Config",
    ]);
  });
});
