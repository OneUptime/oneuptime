import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Navigation from "../../../UI/Utils/Navigation";
import {
  StatusPageSubscriberUnsubscribeChannel,
  StatusPageSubscriberUnsubscribeState,
} from "../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import API from "../../../../App/FeatureSet/StatusPage/src/Utils/API";
import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import UnsubscribePage from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/Unsubscribe";
import { ManageLinkChannels } from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/ManageLinkRequestPage";
import { getJestSpyOn } from "../../Spy";

/*
 * Status page > the page every unsubscribe link in a notification opens,
 * {statusPageUrl}/unsubscribe/{subscriberId}-{token}.
 *
 * What it must do: work without signing in on a private page (it never looks
 * for a session), change nothing until the reader confirms (it only reads on
 * load), and say clearly what happened. The credential arrives through
 * sessionStorage, where the SensitiveUrlToken bootstrap moves it out of the
 * address bar.
 *
 * Translations resolve against the StatusPage's real en.json and never fall
 * back to a default: a key missing from the locales renders as the bare key.
 */

jest.mock("react-i18next", () => {
  const english: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/StatusPage/src/Locales/en.json",
  ) as Record<string, unknown>;

  const translate: (
    key: string,
    options?: Record<string, unknown>,
  ) => string = (key: string, options?: Record<string, unknown>): string => {
    let node: unknown = english;

    for (const part of key.split(".")) {
      node =
        node !== null && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined;
    }

    if (typeof node !== "string") {
      return key;
    }

    return node.replace(
      /\{\{(\w+)\}\}/g,
      (_placeholder: string, name: string): string => {
        return String(options?.[name] ?? "");
      },
    );
  };

  return {
    useTranslation: () => {
      return { t: translate };
    },
  };
});

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";

const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUBSCRIBER_ID: string = "22222222-2222-4222-8222-222222222222";
const TOKEN: string = "9e".repeat(32);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "StatusPage",
  "src",
  "Locales",
);

const english: Record<string, any> = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Record<string, any>;

const COPY: Record<string, string> = english["subscribe"]["unsubscribe"];

let details: JSONObject;
let postAnswer: JSONObject | Error;
let gets: Array<string>;
let posts: Array<string>;
let isPrivate: boolean;
let manageLinkChannels: ManageLinkChannels | undefined;

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <UnsubscribePage
        statusPageName="Site 03"
        logoFileId={new ObjectID(STATUS_PAGE_ID.toString())}
        manageLinkChannels={manageLinkChannels}
      />,
    );
  });
}

function stash(credential: string | null): void {
  window.sessionStorage.clear();

  if (credential !== null) {
    window.sessionStorage.setItem(STORAGE_KEY, credential);
  }
}

beforeEach(() => {
  isPrivate = true;
  manageLinkChannels = {
    enableEmailSubscribers: true,
    enableSMSSubscribers: true,
    enableSlackSubscribers: false,
    enableMicrosoftTeamsSubscribers: false,
  };
  details = {
    state: StatusPageSubscriberUnsubscribeState.Subscribed,
    channel: StatusPageSubscriberUnsubscribeChannel.Email,
    contact: "site03-all@acme.com",
    wasAddedByTeam: false,
  };
  postAnswer = { state: StatusPageSubscriberUnsubscribeState.Unsubscribed };
  gets = [];
  posts = [];

  stash(`${SUBSCRIBER_ID}-${TOKEN}`);

  getJestSpyOn(StatusPageUtil, "getStatusPageId").mockReturnValue(
    STATUS_PAGE_ID,
  );
  getJestSpyOn(StatusPageUtil, "isPrivateStatusPage").mockImplementation(
    (): boolean => {
      return isPrivate;
    },
  );
  getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(false);
  getJestSpyOn(StatusPageUtil, "checkIfUserHasLoggedIn").mockImplementation(
    () => {},
  );
  getJestSpyOn(Navigation, "navigate").mockImplementation(() => {});

  getJestSpyOn(API, "get").mockImplementation(
    async (options: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject>> => {
      gets.push(options.url.toString());
      return new HTTPResponse<JSONObject>(200, details, {});
    },
  );
  getJestSpyOn(API, "post").mockImplementation(
    async (options: {
      url: { toString: () => string };
    }): Promise<HTTPResponse<JSONObject>> => {
      posts.push(options.url.toString());

      if (postAnswer instanceof Error) {
        throw postAnswer;
      }

      return new HTTPResponse<JSONObject>(200, postAnswer, {});
    },
  );
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  jest.restoreAllMocks();
});

describe("Status page unsubscribe page", () => {
  test("asks before it changes anything, naming the subscription", async () => {
    await renderPage();

    expect(await screen.findByText(COPY["confirmPrompt"]!)).toBeInTheDocument();
    expect(screen.getByTestId("unsubscribe-contact")).toHaveTextContent(
      `${COPY["channelEmail"]}: site03-all@acme.com`,
    );
    expect(
      screen.getByRole("heading", { name: "Unsubscribe from Site 03" }),
    ).toBeInTheDocument();

    // Opening the page only reads, on the page's own origin.
    expect(gets).toHaveLength(1);
    expect(
      gets[0]!.endsWith(
        `/status-page-api/unsubscribe/${STATUS_PAGE_ID.toString()}/${SUBSCRIBER_ID}/${TOKEN}`,
      ),
    ).toBe(true);
    expect(posts).toEqual([]);
  });

  test("never asks the reader of a private page to sign in", async () => {
    await renderPage();

    await screen.findByText(COPY["confirmPrompt"]!);

    expect(StatusPageUtil.checkIfUserHasLoggedIn).not.toHaveBeenCalled();
    expect(Navigation.navigate).not.toHaveBeenCalled();
  });

  test("unsubscribes only when the reader confirms", async () => {
    await renderPage();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("unsubscribe-confirm"));
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toContain(
      `/status-page-api/unsubscribe/${STATUS_PAGE_ID.toString()}/${SUBSCRIBER_ID}/${TOKEN}`,
    );
    expect(await screen.findByText(COPY["success"]!)).toBeInTheDocument();

    // Done with the credential: reloading does not offer to do it again.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("warns the reader of a subscription the team added before they confirm", async () => {
    details = { ...details, wasAddedByTeam: true };

    await renderPage();

    expect(
      await screen.findByTestId("unsubscribe-added-by-team"),
    ).toHaveTextContent(COPY["addedByTeamWarning"]!);
  });

  test("says nothing about the team for a subscription its owner signed up for", async () => {
    await renderPage();

    await screen.findByText(COPY["confirmPrompt"]!);

    expect(
      screen.queryByTestId("unsubscribe-added-by-team"),
    ).not.toBeInTheDocument();
  });

  test("on a public page, offers the manage page instead; on a private one it does not", async () => {
    isPrivate = false;
    await renderPage();

    /*
     * The manage page asks for the same credential, and it reaches that page
     * through the tab's session: the link is the token-free route, never one
     * that names the subscriber or carries the token.
     */
    const manage: HTMLElement = await screen.findByText(COPY["manageInstead"]!);
    expect(manage.closest("a")).toHaveAttribute("href", "/update-subscription");
    expect(manage.closest("a")!.getAttribute("href")).not.toContain(
      SUBSCRIBER_ID,
    );
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      `${SUBSCRIBER_ID}-${TOKEN}`,
    );

    cleanup();
    isPrivate = true;
    await renderPage();

    await screen.findByText(COPY["confirmPrompt"]!);
    expect(screen.queryByText(COPY["manageInstead"]!)).not.toBeInTheDocument();
  });

  test("on a status page's own address, the manage page is the preview route, token-free too", async () => {
    isPrivate = false;
    getJestSpyOn(StatusPageUtil, "isPreviewPage").mockReturnValue(true);
    // The page this tab shows, as the master page sets it.
    StatusPageUtil.setStatusPageId(STATUS_PAGE_ID);

    await renderPage();

    const manage: HTMLElement = await screen.findByText(COPY["manageInstead"]!);
    expect(manage.closest("a")).toHaveAttribute(
      "href",
      `/status-page/${STATUS_PAGE_ID.toString()}/update-subscription`,
    );

    StatusPageUtil.setStatusPageId(null);
  });

  test("a subscription already cancelled says so and offers nothing to press", async () => {
    details = {
      ...details,
      state: StatusPageSubscriberUnsubscribeState.Unsubscribed,
    };

    await renderPage();

    expect(
      await screen.findByText(COPY["alreadyUnsubscribed"]!),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("unsubscribe-confirm")).not.toBeInTheDocument();
  });

  test("a link the server does not recognise is called invalid", async () => {
    details = { state: StatusPageSubscriberUnsubscribeState.Invalid };

    await renderPage();

    expect(await screen.findByText(COPY["invalidLink"]!)).toBeInTheDocument();
    expect(screen.queryByTestId("unsubscribe-confirm")).not.toBeInTheDocument();
  });

  test("an old id-only link is called out of date, without asking the server", async () => {
    stash(SUBSCRIBER_ID);
    isPrivate = false;

    await renderPage();

    expect(await screen.findByText(COPY["outOfDateLink"]!)).toBeInTheDocument();
    /*
     * The id alone opens no manage page either: the way on is the Subscribe
     * page, whose Manage Existing Subscription tab sends a new link to the
     * subscription's own contact.
     */
    expect(
      screen.getByText(COPY["manageSubscription"]!).closest("a"),
    ).toHaveAttribute("href", "/subscribe/email");
    expect(
      document.querySelector(`a[href*="${SUBSCRIBER_ID}"]`),
    ).not.toBeInTheDocument();
    expect(gets).toEqual([]);
    expect(posts).toEqual([]);
  });

  test("an out-of-date link sends the reader to the first channel the page offers with a manage tab", async () => {
    stash(SUBSCRIBER_ID);
    isPrivate = false;
    manageLinkChannels = {
      enableEmailSubscribers: false,
      enableSMSSubscribers: false,
      enableSlackSubscribers: true,
      enableMicrosoftTeamsSubscribers: true,
    };

    await renderPage();

    expect(
      (await screen.findByText(COPY["manageSubscription"]!)).closest("a"),
    ).toHaveAttribute("href", "/subscribe/slack");
  });

  test("an out-of-date link offers no way on where there is none to offer", async () => {
    stash(SUBSCRIBER_ID);

    // A private page: the reader may not be able to sign in.
    isPrivate = true;
    await renderPage();
    expect(await screen.findByText(COPY["outOfDateLink"]!)).toBeInTheDocument();
    expect(
      screen.queryByText(COPY["manageSubscription"]!),
    ).not.toBeInTheDocument();

    // A public page that offers no channel with a Manage Existing Subscription tab.
    cleanup();
    isPrivate = false;
    manageLinkChannels = {
      enableEmailSubscribers: false,
      enableSMSSubscribers: false,
      enableSlackSubscribers: false,
      enableMicrosoftTeamsSubscribers: false,
    };
    await renderPage();
    expect(await screen.findByText(COPY["outOfDateLink"]!)).toBeInTheDocument();
    expect(
      screen.queryByText(COPY["manageSubscription"]!),
    ).not.toBeInTheDocument();
  });

  test("no credential, or a stale one from another flow, is an invalid link", async () => {
    for (const credential of [null, "some-reset-password-token"]) {
      cleanup();
      stash(credential);

      await renderPage();

      expect(await screen.findByText(COPY["invalidLink"]!)).toBeInTheDocument();
    }

    expect(gets).toEqual([]);
  });

  test("a failed confirmation says so and can be tried again", async () => {
    postAnswer = new Error("network down");

    await renderPage();

    await act(async () => {
      fireEvent.click(await screen.findByTestId("unsubscribe-confirm"));
    });

    expect(await screen.findByText(COPY["failed"]!)).toBeInTheDocument();
    expect(screen.getByTestId("unsubscribe-confirm")).toBeInTheDocument();
    // The credential is kept for the retry.
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe(
      `${SUBSCRIBER_ID}-${TOKEN}`,
    );
  });
});

describe("the unsubscribe page's translations", () => {
  const KEYS: Array<string> = Object.keys(COPY);

  test("the page has its copy in en.json", () => {
    expect(KEYS.sort()).toEqual(
      [
        "addedByTeamWarning",
        "alreadyUnsubscribed",
        "channelEmail",
        "channelMicrosoftTeams",
        "channelSlack",
        "channelSms",
        "channelWebhook",
        "confirmButton",
        "confirmPrompt",
        "failed",
        "invalidLink",
        "loadFailed",
        "manageInstead",
        "manageSubscription",
        "outOfDateLink",
        "success",
        "title",
        "titleWithName",
      ].sort(),
    );
  });

  test("every StatusPage locale translates every string, keeping its placeholders", () => {
    const locales: Array<string> = fs
      .readdirSync(LOCALES_DIR)
      .filter((file: string) => {
        return file.endsWith(".json") && file !== "en.json";
      });

    expect(locales).toHaveLength(16);

    for (const file of locales) {
      const translated: Record<string, unknown> = (
        JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
        ) as Record<string, any>
      )["subscribe"]["unsubscribe"];

      for (const key of KEYS) {
        const value: unknown = translated[key];

        expect([file, key, typeof value]).toEqual([file, key, "string"]);
        expect([
          file,
          key,
          ((value as string).match(/\{\{[^}]+\}\}/g) || []).sort(),
        ]).toEqual([
          file,
          key,
          (COPY[key]!.match(/\{\{[^}]+\}\}/g) || []).sort(),
        ]);

        // Loanwords such as "Webhook" may stay; sentences must not.
        if (COPY[key]!.length > 20) {
          expect([file, key, value]).not.toEqual([file, key, COPY[key]]);
        }
      }
    }
  });
});
