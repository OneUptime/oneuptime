import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > Confirm Subscription, as the link in a confirmation email or
 * text opens it: {statusPageUrl}/confirm-subscription/{id}?verification-token=
 * {code}.
 *
 * A link works for a day after it is sent. One opened later - or one that
 * is not valid: a part missing, another subscription's code, a subscription
 * a newer sign-up replaced - confirms nothing, and the page says so in the
 * reader's language, with the one way to get a new link: Subscribe again,
 * to the Subscribe page of email, or else SMS. Anything else that goes
 * wrong - the server, the network - is shown as it is.
 *
 * The real page renders; the page chrome and the network are stubbed. Copy
 * resolves against the status page's real en.json.
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

    return typeof node === "string" ? node : key;
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
let isPreviewPage: boolean = false;

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage", () => {
  return {
    __esModule: true,
    default: {
      // The page this tab shows, from where RouteMap reads it too.
      getStatusPageId: (): ObjectID | null => {
        return StatusPageInTab.get();
      },
      checkIfUserHasLoggedIn: (): void => {
        checkIfUserHasLoggedIn();
      },
      isPreviewPage: (): boolean => {
        return isPreviewPage;
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
        return err instanceof HTTPErrorResponse
          ? err.message || "Server Error. Please try again"
          : err instanceof Error
            ? err.message
            : String(err);
      },
    },
  };
});

import ConfirmSubscription from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/ConfirmSubscription";
import English from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import PageMap from "../../../../App/FeatureSet/StatusPage/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/StatusPage/src/Utils/RouteMap";
import StatusPageInTab from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageInTab";

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";
const SUBSCRIBER_ID: string = "22222222-2222-4222-8222-222222222222";
const CODE: string = "3f1c9a7be2d84f0a9c6b5e4d3a2f1e0d";

const COPY: Record<string, string> = English.subscribe.confirm;

interface Channels {
  enableEmailSubscribers: boolean;
  enableSMSSubscribers: boolean;
}

const EMAIL_AND_SMS: Channels = {
  enableEmailSubscribers: true,
  enableSMSSubscribers: true,
};

// What the confirm route answers.
let answer: HTTPResponse<JSONObject> | HTTPErrorResponse | Error;
let code: string | null;
let subscriberId: string;
let navigatedTo: Array<string>;

async function renderPage(channels: Channels = EMAIL_AND_SMS): Promise<void> {
  await act(async () => {
    render(
      <ConfirmSubscription
        pageRoute={new Route("/confirm-subscription/:id")}
        onLoadComplete={(): void => {}}
        signUpChannels={channels}
      />,
    );
  });
}

function requestedUrls(): Array<string> {
  return apiGet.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as { url: { toString: () => string } }).url.toString();
  });
}

function linkNotValidShown(): boolean {
  return Boolean(screen.queryByTestId("confirm-subscription-link-not-valid"));
}

function subscribeAgain(): HTMLElement | null {
  return screen.queryByTestId("confirm-subscription-subscribe-again");
}

beforeEach(() => {
  StatusPageInTab.set(STATUS_PAGE_ID);
  isPreviewPage = false;
  code = CODE;
  subscriberId = SUBSCRIBER_ID;
  navigatedTo = [];
  answer = new HTTPResponse<JSONObject>(200, {}, {});

  checkIfUserHasLoggedIn.mockReset();
  apiGet.mockReset();
  apiGet.mockImplementation(async (): Promise<unknown> => {
    if (answer instanceof Error) {
      throw answer;
    }

    return answer;
  });

  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
    (): ObjectID => {
      return new ObjectID(subscriberId);
    },
  );
  getJestSpyOn(Navigation, "getQueryStringByName").mockImplementation(
    (name: string): string | null => {
      return name === "verification-token" ? code : null;
    },
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation(
    (route: unknown): void => {
      navigatedTo.push(String(route));
    },
  );
});

afterEach(() => {
  cleanup();
  StatusPageInTab.set(null);
  jest.restoreAllMocks();
});

describe("a link to confirm a subscription, opened", () => {
  test("asks the confirm route with the link's id and code, and says the subscription is confirmed", async () => {
    await renderPage();

    expect(await screen.findByText(COPY["success"]!)).toBeInTheDocument();

    expect(requestedUrls()).toHaveLength(1);

    const asked: URL = new URL(requestedUrls()[0]!);
    expect(
      asked.pathname.endsWith(`/confirm-subscription/${SUBSCRIBER_ID}`),
    ).toBe(true);
    expect(asked.searchParams.get("verification-token")).toBe(CODE);

    expect(linkNotValidShown()).toBe(false);
    expect(subscribeAgain()).toBeNull();
    expect(checkIfUserHasLoggedIn).toHaveBeenCalled();
  });

  test.each([
    [
      "has expired (400)",
      400,
      "This link to confirm your subscription has expired: links work for 24 hours. To get a new one, subscribe again.",
    ],
    [
      "is not valid (404)",
      404,
      "Subscriber not found or confirmation token is invalid",
    ],
  ])(
    "that %s says so in the reader's words, with Subscribe again",
    async (_label: string, statusCode: number, serverMessage: string) => {
      answer = new HTTPErrorResponse(
        statusCode,
        { message: serverMessage },
        {},
      );

      await renderPage();

      await waitFor(() => {
        expect(linkNotValidShown()).toBe(true);
      });

      expect(screen.getByText(COPY["linkNotValid"]!)).toBeInTheDocument();
      // The server's own words are for the API, not the reader.
      expect(screen.queryByText(serverMessage)).toBeNull();
      expect(screen.queryByText(COPY["success"]!)).toBeNull();
      expect(subscribeAgain()).toHaveTextContent(COPY["subscribeAgain"]!);
    },
  );

  test("Subscribe again leads to the email Subscribe page", async () => {
    answer = new HTTPErrorResponse(400, { message: "expired" }, {});

    await renderPage();

    const button: HTMLElement = await screen.findByTestId(
      "confirm-subscription-subscribe-again",
    );

    await act(async () => {
      fireEvent.click(button);
    });

    expect(navigatedTo).toEqual([
      RouteMap[PageMap.SUBSCRIBE_EMAIL]!.toString(),
    ]);
  });

  test("to the SMS Subscribe page when the page offers no email sign-ups", async () => {
    answer = new HTTPErrorResponse(404, { message: "not found" }, {});

    await renderPage({
      enableEmailSubscribers: false,
      enableSMSSubscribers: true,
    });

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId("confirm-subscription-subscribe-again"),
      );
    });

    expect(navigatedTo).toEqual([RouteMap[PageMap.SUBSCRIBE_SMS]!.toString()]);
  });

  test("on a page that offers neither, the message stands alone", async () => {
    answer = new HTTPErrorResponse(400, { message: "expired" }, {});

    await renderPage({
      enableEmailSubscribers: false,
      enableSMSSubscribers: false,
    });

    await waitFor(() => {
      expect(linkNotValidShown()).toBe(true);
    });

    expect(screen.getByText(COPY["linkNotValid"]!)).toBeInTheDocument();
    expect(subscribeAgain()).toBeNull();
  });

  test("in the dashboard's preview, Subscribe again stays in the preview", async () => {
    isPreviewPage = true;
    answer = new HTTPErrorResponse(400, { message: "expired" }, {});

    await renderPage();

    await act(async () => {
      fireEvent.click(
        await screen.findByTestId("confirm-subscription-subscribe-again"),
      );
    });

    expect(navigatedTo).toEqual([
      `/status-page/${STATUS_PAGE_ID}/subscribe/email`,
    ]);
  });

  test.each([
    ["no code", null, SUBSCRIBER_ID],
    ["an empty code", "", SUBSCRIBER_ID],
  ])(
    "with %s confirms nothing, asks nothing, and offers a new link",
    async (_label: string, linkCode: string | null, id: string) => {
      code = linkCode;
      subscriberId = id;

      await renderPage();

      await waitFor(() => {
        expect(linkNotValidShown()).toBe(true);
      });

      expect(apiGet).not.toHaveBeenCalled();
      expect(subscribeAgain()).not.toBeNull();
    },
  );

  test("with an id that is not one, confirms nothing and offers a new link", async () => {
    getJestSpyOn(Navigation, "getLastParamAsObjectID").mockImplementation(
      (): ObjectID => {
        throw new Error("Invalid ID");
      },
    );

    await renderPage();

    await waitFor(() => {
      expect(linkNotValidShown()).toBe(true);
    });

    expect(apiGet).not.toHaveBeenCalled();
  });

  test.each([
    [
      "the server's own error (500)",
      new HTTPErrorResponse(
        500,
        { message: "Something broke on our side." },
        {},
      ),
      "Something broke on our side.",
    ],
    [
      "too many requests (429)",
      new HTTPErrorResponse(
        429,
        { message: "Too many requests. Please try again later." },
        {},
      ),
      "Too many requests. Please try again later.",
    ],
    [
      "the network",
      new Error("Error connecting to server. Please try again in few minutes."),
      "Error connecting to server. Please try again in few minutes.",
    ],
  ])(
    "anything else - %s - is shown as it is, with no Subscribe again: it is not the link's doing",
    async (
      _label: string,
      failure: HTTPErrorResponse | Error,
      shown: string,
    ) => {
      answer = failure;

      await renderPage();

      expect(await screen.findByText(shown)).toBeInTheDocument();
      expect(linkNotValidShown()).toBe(false);
      expect(subscribeAgain()).toBeNull();
      expect(screen.queryByText(COPY["success"]!)).toBeNull();
    },
  );
});
