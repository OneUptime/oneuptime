import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
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
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import Phone from "../../../Types/Phone";
import { StatusPageSubscriberUnsubscribeState } from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > the subscriber's manage page (Update Subscription), as its
 * link opens it: {statusPageUrl}/update-subscription/{subscriberId}-{token}.
 *
 * The link carries the subscription's token, as the unsubscribe link does,
 * and the page's routes take it: the subscriber id alone opens nothing. The
 * credential arrives through sessionStorage, where the SensitiveUrlToken
 * bootstrap moves it out of the address bar - or where the unsubscribe page
 * leaves it when it offers this page instead.
 *
 * What the page must do: check the link with the server before anything
 * else, load and save the subscription only through the routes that take
 * the token, and say plainly - in the reader's language - when a link has
 * expired or is not valid, with the one way to get a new one.
 *
 * The real page renders, with the real form; the page chrome, the network
 * and the status page's own resources are stubbed. Copy resolves against
 * the status page's real en.json.
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
      default: (props: { children: ReactElement }): ReactElement => {
        return <div>{props.children}</div>;
      },
    };
  },
);

const checkIfUserHasLoggedIn: MockFunction = getJestMockFunction();

// The status page this tab shows, as StatusPageUtil.getStatusPageId answers it.
let tabStatusPageId: string | null = null;

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage", () => {
  return {
    __esModule: true,
    default: {
      getStatusPageId: (): ObjectID | null => {
        return tabStatusPageId ? new ObjectID(tabStatusPageId) : null;
      },
      checkIfUserHasLoggedIn: (): void => {
        checkIfUserHasLoggedIn();
      },
      isPreviewPage: (): boolean => {
        return false;
      },
    },
  };
});

const apiGet: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<unknown>): unknown => {
        return apiGet(...args);
      },
      getDefaultHeaders: (): Record<string, string> => {
        return {};
      },
      getFriendlyMessage: (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      },
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
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

import UpdateSubscription from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/UpdateSubscription";
import English from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import ObjectID from "../../../Types/ObjectID";

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";
const SUBSCRIBER_ID: string = "22222222-2222-4222-8222-222222222222";
const TOKEN: string = "7d".repeat(32);

const COPY: Record<string, string> = English.subscribe.update;

interface Channels {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
  enableSlackSubscribers: boolean;
  enableMicrosoftTeamsSubscribers: boolean;
}

const EVERY_CHANNEL: Channels = {
  enableEmailSubscribers: true,
  enableSMSSubscribers: true,
  enableSlackSubscribers: true,
  enableMicrosoftTeamsSubscribers: true,
};

// What the server says about the link, before anything is shown.
let linkState: StatusPageSubscriberUnsubscribeState | Error;

function stash(credential: string | null): void {
  window.sessionStorage.clear();

  if (credential !== null) {
    window.sessionStorage.setItem(STORAGE_KEY, credential);
  }
}

async function renderPage(channels: Channels = EVERY_CHANNEL): Promise<void> {
  await act(async () => {
    render(
      <UpdateSubscription
        pageRoute={new Route("/update-subscription")}
        onLoadComplete={(): void => {}}
        enableEmailSubscribers={channels.enableEmailSubscribers}
        enableSMSSubscribers={channels.enableSMSSubscribers}
        enableSlackSubscribers={channels.enableSlackSubscribers}
        enableMicrosoftTeamsSubscribers={
          channels.enableMicrosoftTeamsSubscribers
        }
        enableWebhookSubscribers={true}
        allowSubscribersToChooseResources={false}
        allowSubscribersToChooseEventTypes={false}
      />,
    );
  });
}

function requestedUrls(mock: MockFunction): Array<string> {
  return mock.mock.calls.map((call: Array<unknown>): string => {
    const options: {
      url?: { toString: () => string };
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    } = call[0] as {
      url?: { toString: () => string };
      requestOptions?: { overrideRequestUrl?: { toString: () => string } };
    };

    return (
      options.url?.toString() ||
      options.requestOptions?.overrideRequestUrl?.toString() ||
      ""
    );
  });
}

function linkNotValidShown(): boolean {
  return Boolean(screen.queryByTestId("update-subscription-link-not-valid"));
}

beforeEach(() => {
  tabStatusPageId = STATUS_PAGE_ID;
  stash(`${SUBSCRIBER_ID}-${TOKEN}`);
  linkState = StatusPageSubscriberUnsubscribeState.Subscribed;

  checkIfUserHasLoggedIn.mockReset();
  apiGet.mockReset();
  apiGet.mockImplementation(async (): Promise<HTTPResponse<JSONObject>> => {
    if (linkState instanceof Error) {
      throw linkState;
    }

    return new HTTPResponse<JSONObject>(200, { state: linkState }, {});
  });

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<StatusPageSubscriber> => {
    const subscriber: StatusPageSubscriber = new StatusPageSubscriber();
    subscriber._id = SUBSCRIBER_ID;
    subscriber.subscriberPhone = new Phone("+15555550123");
    subscriber.isUnsubscribed = false;
    return subscriber;
  });

  createOrUpdateMock.mockReset();
  createOrUpdateMock.mockResolvedValue({ data: {} });

  getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  tabStatusPageId = null;
  jest.restoreAllMocks();
});

describe("the manage page opened from its link", () => {
  test("checks the link first, then loads the subscription through the route that takes the token", async () => {
    await renderPage();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });

    // The link, described by the unsubscribe page's read-only route.
    expect(requestedUrls(apiGet)).toEqual([
      expect.stringContaining(
        `/status-page-api/unsubscribe/${STATUS_PAGE_ID}/${SUBSCRIBER_ID}/${TOKEN}`,
      ),
    ]);

    // The subscription, through get-subscription with the token.
    expect(requestedUrls(getItemMock)).toEqual([
      expect.stringContaining(
        `/status-page-api/get-subscription/${STATUS_PAGE_ID}/${SUBSCRIBER_ID}/${TOKEN}`,
      ),
    ]);

    expect(
      await screen.findByRole("heading", { name: COPY["title"]! }),
    ).toBeInTheDocument();
    expect(linkNotValidShown()).toBe(false);
  });

  test("saves through the route that takes the token - an SMS subscriber's included", async () => {
    await renderPage();

    const submit: HTMLElement = await screen.findByRole("button", {
      name: COPY["submit"]!,
    });

    await act(async () => {
      fireEvent.click(submit);
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(requestedUrls(createOrUpdateMock)).toEqual([
      expect.stringContaining(
        `/status-page-api/update-subscription/${STATUS_PAGE_ID}/${SUBSCRIBER_ID}/${TOKEN}`,
      ),
    ]);
    expect(await screen.findByText(COPY["saved"]!)).toBeInTheDocument();
  });

  test("still asks a private page's reader to sign in", async () => {
    await renderPage();

    expect(checkIfUserHasLoggedIn).toHaveBeenCalled();
  });

  test("a subscription already cancelled can still be opened, to subscribe again", async () => {
    linkState = StatusPageSubscriberUnsubscribeState.Unsubscribed;

    await renderPage();

    await waitFor(() => {
      expect(getItemMock).toHaveBeenCalledTimes(1);
    });
    expect(linkNotValidShown()).toBe(false);
  });
});

describe("a link that does not open a subscription", () => {
  test("an old link with only the subscriber id has expired: it says so, and asks the server nothing", async () => {
    stash(SUBSCRIBER_ID);

    await renderPage();

    expect(await screen.findByText(COPY["linkNotValid"]!)).toBeInTheDocument();
    expect(apiGet).not.toHaveBeenCalled();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
    // No form to fill in.
    expect(
      screen.queryByRole("button", { name: COPY["submit"]! }),
    ).not.toBeInTheDocument();
  });

  test.each([
    ["no credential at all", null],
    ["a token left over from another flow", "some-reset-password-token"],
    ["a truncated link", `${SUBSCRIBER_ID}-${TOKEN.slice(0, 40)}`],
  ])(
    "%s is not a link: it says so, and asks the server nothing",
    async (_label: string, credential: string | null) => {
      stash(credential);

      await renderPage();

      expect(
        await screen.findByText(COPY["linkNotValid"]!),
      ).toBeInTheDocument();
      expect(apiGet).not.toHaveBeenCalled();
      expect(getItemMock).not.toHaveBeenCalled();
    },
  );

  test("a link the server does not recognise says the same, and loads nothing", async () => {
    linkState = StatusPageSubscriberUnsubscribeState.Invalid;

    await renderPage();

    expect(await screen.findByText(COPY["linkNotValid"]!)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(getItemMock).not.toHaveBeenCalled();
  });

  test("the one way on is a new link, from the Subscribe page of a channel the page offers", async () => {
    stash(SUBSCRIBER_ID);

    await renderPage();

    const button: HTMLElement = await screen.findByTestId(
      "update-subscription-get-new-link",
    );
    expect(button).toHaveTextContent(COPY["getNewLink"]!);

    await act(async () => {
      fireEvent.click(button);
    });

    expect(Navigation.navigate).toHaveBeenCalledTimes(1);
    expect(
      (
        (Navigation.navigate as unknown as MockFunction).mock
          .calls[0]![0] as Route
      ).toString(),
    ).toBe("/subscribe/email");
  });

  test.each([
    [
      "SMS only",
      {
        enableEmailSubscribers: false,
        enableSMSSubscribers: true,
        enableSlackSubscribers: false,
        enableMicrosoftTeamsSubscribers: false,
      },
      "/subscribe/sms",
    ],
    [
      "Microsoft Teams only",
      {
        enableEmailSubscribers: false,
        enableSMSSubscribers: false,
        enableSlackSubscribers: false,
        enableMicrosoftTeamsSubscribers: true,
      },
      "/subscribe/microsoft-teams",
    ],
  ])(
    "on a page that offers %s, the new link comes from that channel's Subscribe page",
    async (_label: string, channels: Channels, route: string) => {
      stash(SUBSCRIBER_ID);

      await renderPage(channels);

      await act(async () => {
        fireEvent.click(
          await screen.findByTestId("update-subscription-get-new-link"),
        );
      });

      expect(
        (
          (Navigation.navigate as unknown as MockFunction).mock
            .calls[0]![0] as Route
        ).toString(),
      ).toBe(route);
    },
  );

  test("on a page that offers no channel with a Manage Existing Subscription tab, there is no button", async () => {
    stash(SUBSCRIBER_ID);

    await renderPage({
      enableEmailSubscribers: false,
      enableSMSSubscribers: false,
      enableSlackSubscribers: false,
      enableMicrosoftTeamsSubscribers: false,
    });

    expect(await screen.findByText(COPY["linkNotValid"]!)).toBeInTheDocument();
    expect(
      screen.queryByTestId("update-subscription-get-new-link"),
    ).not.toBeInTheDocument();
  });

  test("a link that could not be checked says so, and loads nothing", async () => {
    linkState = new Error("network down");

    await renderPage();

    expect(await screen.findByText(COPY["loadFailed"]!)).toBeInTheDocument();
    expect(getItemMock).not.toHaveBeenCalled();
    expect(linkNotValidShown()).toBe(false);
  });
});

describe("the manage page's words", () => {
  test("are in every status page language", () => {
    const localesDir: string = path.resolve(
      __dirname,
      "../../../../App/FeatureSet/StatusPage/src/Locales",
    );

    const locales: Array<string> = fs
      .readdirSync(localesDir)
      .filter((file: string): boolean => {
        return file.endsWith(".json") && file !== "en.json";
      });

    expect(locales).toHaveLength(16);

    for (const file of locales) {
      const update: Record<string, unknown> = (
        JSON.parse(
          fs.readFileSync(path.join(localesDir, file), "utf8"),
        ) as Record<string, any>
      )["subscribe"]["update"];

      for (const key of ["linkNotValid", "getNewLink", "loadFailed"]) {
        const value: unknown = update[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);
        expect([file, key, value]).not.toEqual([file, key, COPY[key]]);
      }
    }
  });

  test("never show the subscriber id or the token, nor put them in the address", async () => {
    await renderPage();

    await screen.findByRole("button", { name: COPY["submit"]! });

    expect(document.body.textContent).not.toContain(SUBSCRIBER_ID);
    expect(document.body.textContent).not.toContain(TOKEN);
    expect(window.location.href).not.toContain(TOKEN);
    expect(Navigation.navigate).not.toHaveBeenCalled();

    cleanup();
    stash(SUBSCRIBER_ID);
    await renderPage();

    await screen.findByText(COPY["linkNotValid"]!);
    expect(document.body.textContent).not.toContain(SUBSCRIBER_ID);
  });
});
