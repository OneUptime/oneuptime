import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Route from "../../../Types/API/Route";

/*
 * The Subscribe page lists its channels in a side menu only when there is
 * more than one to pick from. Most pages offer email alone, and drew a menu
 * holding that one entry beside the form: a choice nobody had to make.
 *
 * And on the email form, the address field says nothing of its own to a
 * visitor who is not signed in: the card above it already says where
 * updates go, and the field repeated it word for word.
 *
 * These render the real subscribe pages; only the page chrome (which draws
 * the menu it is handed), the network and the side menu itself (drawn as a
 * marker) are stubbed. Copy resolves against the status page's real
 * en.json.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (key: string) => string = (key: string): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node === "string") {
      return node;
    }

    const flat: unknown = english[key];

    return typeof flat === "string" ? flat : key;
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: {
        children: ReactElement;
        sideMenu?: ReactElement | undefined;
      }): ReactElement => {
        return (
          <div>
            <div data-testid="page-side-menu-slot">{props.sideMenu}</div>
            <div data-testid="page-body">{props.children}</div>
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        return (
          <nav
            data-testid="subscribe-side-menu"
            data-channels={[
              props["enableEmailSubscribers"] ? "email" : "",
              props["enableSMSSubscribers"] ? "sms" : "",
              props["enableSlackSubscribers"] ? "slack" : "",
              props["enableMicrosoftTeamsSubscribers"] ? "teams" : "",
              props["enableWebhookSubscribers"] ? "webhook" : "",
            ]
              .filter(Boolean)
              .join(",")}
          />
        );
      },
    };
  },
);

// The status page this tab shows, as StatusPageUtil.getStatusPageId answers it.
let tabStatusPageId: string | null = null;

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage", () => {
  return {
    __esModule: true,
    default: {
      getStatusPageId: (): ObjectID | null => {
        return tabStatusPageId ? new ObjectID(tabStatusPageId) : null;
      },
      checkIfUserHasLoggedIn: (): void => {},
      isPreviewPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: (route: unknown): unknown => {
        return route;
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      getDefaultHeaders: (): Record<string, string> => {
        return {};
      },
      getFriendlyMessage: (err: unknown): string => {
        return String(err);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      createOrUpdate: async (): Promise<unknown> => {
        return {};
      },
      getList: async (): Promise<{ data: Array<unknown>; count: number }> => {
        return { data: [], count: 0 };
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

import EmailSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/EmailSubscribe";
import SmsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SmsSubscribe";
import SlackSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SlackSubscribe";
import MicrosoftTeamsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/MicrosoftTeamsSubscribe";
import WebhookSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/WebhookSubscribe";
import {
  getSubscribeChannelCount,
  isSubscribeChannelMenuShown,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SubscribePageUtils";
import English from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import ObjectID from "../../../Types/ObjectID";

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";

interface Channels {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
  enableWebhookSubscribers: boolean;
}

const NONE: Channels = {
  enableEmailSubscribers: false,
  enableSMSSubscribers: false,
  enableSlackSubscribers: false,
  enableMicrosoftTeamsSubscribers: false,
  enableWebhookSubscribers: false,
};

type SubscribePage = typeof EmailSubscribe;

// Each page, with the channel it is for.
const PAGES: Array<[string, SubscribePage, keyof Channels]> = [
  ["email", EmailSubscribe, "enableEmailSubscribers"],
  ["SMS", SmsSubscribe, "enableSMSSubscribers"],
  ["Slack", SlackSubscribe, "enableSlackSubscribers"],
  [
    "Microsoft Teams",
    MicrosoftTeamsSubscribe,
    "enableMicrosoftTeamsSubscribers",
  ],
  ["webhook", WebhookSubscribe, "enableWebhookSubscribers"],
];

beforeEach(() => {
  tabStatusPageId = STATUS_PAGE_ID;
});

afterEach(() => {
  cleanup();
});

async function renderPage(
  Page: SubscribePage,
  channels: Channels,
): Promise<void> {
  await act(async () => {
    render(
      <Page
        pageRoute={new Route("/subscribe")}
        onLoadComplete={(): void => {}}
        {...channels}
        allowSubscribersToChooseResources={false}
        allowSubscribersToChooseEventTypes={false}
      />,
    );
  });
}

function sideMenu(): HTMLElement | null {
  return within(screen.getByTestId("page-side-menu-slot")).queryByTestId(
    "subscribe-side-menu",
  );
}

describe("how many channels a page offers", () => {
  test("counts the channels that are on", () => {
    expect(getSubscribeChannelCount(NONE)).toBe(0);
    expect(
      getSubscribeChannelCount({ ...NONE, enableEmailSubscribers: true }),
    ).toBe(1);
    expect(
      getSubscribeChannelCount({
        enableEmailSubscribers: true,
        enableSMSSubscribers: true,
        enableSlackSubscribers: true,
        enableMicrosoftTeamsSubscribers: true,
        enableWebhookSubscribers: true,
      }),
    ).toBe(5);
  });

  test("the menu is shown only when there is more than one to pick from", () => {
    expect(isSubscribeChannelMenuShown(NONE)).toBe(false);

    for (const [, , channel] of PAGES) {
      expect([
        channel,
        isSubscribeChannelMenuShown({ ...NONE, [channel]: true }),
      ]).toEqual([channel, false]);
    }

    expect(
      isSubscribeChannelMenuShown({
        ...NONE,
        enableEmailSubscribers: true,
        enableWebhookSubscribers: true,
      }),
    ).toBe(true);
  });
});

describe.each(PAGES)(
  "the %s subscribe page",
  (_name: string, Page: SubscribePage, channel: keyof Channels) => {
    test("with only its own channel on: the form alone, with no menu of one", async () => {
      await renderPage(Page, { ...NONE, [channel]: true });

      expect(sideMenu()).toBeNull();
      expect(screen.getByTestId("page-body")).not.toBeEmptyDOMElement();
    });

    test("with another channel on too: the menu, naming every channel that is on", async () => {
      const other: keyof Channels =
        channel === "enableEmailSubscribers"
          ? "enableSMSSubscribers"
          : "enableEmailSubscribers";

      await renderPage(Page, { ...NONE, [channel]: true, [other]: true });

      expect(sideMenu()).not.toBeNull();
      expect(
        sideMenu()!.getAttribute("data-channels")!.split(",").sort(),
      ).toEqual(
        [
          channel === "enableEmailSubscribers" ? "email" : "",
          channel === "enableSMSSubscribers" || other === "enableSMSSubscribers"
            ? "sms"
            : "",
          channel === "enableSlackSubscribers" ? "slack" : "",
          channel === "enableMicrosoftTeamsSubscribers" ? "teams" : "",
          channel === "enableWebhookSubscribers" ? "webhook" : "",
          other === "enableEmailSubscribers" ? "email" : "",
        ]
          .filter(Boolean)
          .sort(),
      );
    });
  },
);

describe("the email form, for a visitor who is not signed in", () => {
  test("the card says where updates go; the field says nothing of its own", async () => {
    await renderPage(EmailSubscribe, { ...NONE, enableEmailSubscribers: true });

    const sentence: string = English.subscribe.email.description;

    expect(sentence.length).toBeGreaterThan(10);

    // Said once, by the card, not again under the field.
    expect(screen.getAllByText(sentence)).toHaveLength(1);

    const field: HTMLElement = await screen.findByRole("textbox", {
      name: /^Your Email/,
    });

    expect(field).toHaveAttribute(
      "placeholder",
      English.subscribe.email.placeholder,
    );
    // Not the model's English column description either.
    expect(screen.queryByText("Email address of the subscriber.")).toBeNull();
    expect(
      screen.queryByText(English.subscribe.email.signedInEmailDescription),
    ).toBeNull();
  });
});
