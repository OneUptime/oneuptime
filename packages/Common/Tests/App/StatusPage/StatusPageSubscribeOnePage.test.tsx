import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
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
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import SubscriberUtil from "../../../UI/Utils/StatusPage";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * Subscribing to a status page is one page: where to send updates, then -
 * on a page that lets subscribers choose resources or event types -
 * Preferences, folded to one line that says what the visitor will get, and
 * Subscribe, the form's one button.
 *
 * It walked two steps for a while (the address, then Preferences), and once
 * a stepped form's action moved to its last step only, a visitor who wanted
 * everything had to press Next before Subscribe. Every resource and event
 * type start ticked, so the line under Preferences says "You will get every
 * update from this status page." and most visitors never open it; whoever
 * wants less opens it, narrows things down, and the line follows.
 *
 * These render the real subscribe pages; only the page chrome, the network
 * and the status page's own resources are stubbed. Copy resolves against the
 * status page's real en.json.
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

    // A flat key, as the shared form components look their words up.
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

jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): ReactElement => {
        return <></>;
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage", () => {
  return {
    __esModule: true,
    default: {
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

const createOrUpdateMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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

import EmailSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/EmailSubscribe";
import SmsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SmsSubscribe";
import SlackSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/SlackSubscribe";
import MicrosoftTeamsSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/MicrosoftTeamsSubscribe";
import WebhookSubscribe from "../../../../App/FeatureSet/StatusPage/src/Pages/Subscribe/WebhookSubscribe";
import English from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";

// The page's own words, as a visitor reading English sees them.
const COPY: {
  preferences: string;
  everything: string;
  pickedResources: string;
  pickedEventTypes: string;
  pickedResourcesAndEventTypes: string;
  noResources: string;
  noEventTypes: string;
  description: string;
} = {
  preferences: English.subscribe.preferences.title,
  description: English.subscribe.preferences.description,
  everything: English.subscribe.preferences.summary.everything,
  pickedResources: English.subscribe.preferences.summary.pickedResources,
  pickedEventTypes: English.subscribe.preferences.summary.pickedEventTypes,
  pickedResourcesAndEventTypes:
    English.subscribe.preferences.summary.pickedResourcesAndEventTypes,
  noResources: English.subscribe.preferences.summary.noResources,
  noEventTypes: English.subscribe.preferences.summary.noEventTypes,
};

interface PageOptions {
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}

const BOTH: PageOptions = {
  allowSubscribersToChooseResources: true,
  allowSubscribersToChooseEventTypes: true,
};

type SubscribePage = typeof EmailSubscribe;

async function renderPage(
  Page: SubscribePage,
  options: PageOptions,
): Promise<void> {
  await act(async () => {
    render(
      <Page
        pageRoute={new Route("/subscribe/email")}
        onLoadComplete={(): void => {}}
        enableEmailSubscribers={true}
        enableSMSSubscribers={true}
        enableSlackSubscribers={true}
        enableMicrosoftTeamsSubscribers={true}
        enableWebhookSubscribers={true}
        allowSubscribersToChooseResources={
          options.allowSubscribersToChooseResources
        }
        allowSubscribersToChooseEventTypes={
          options.allowSubscribersToChooseEventTypes
        }
      />,
    );
  });
}

function subscribeButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Subscribe" });
}

function nextButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Next" });
}

// The folded section's header: a real button, named after its title.
function preferencesHeader(): HTMLElement | null {
  return screen.queryByRole("button", { name: COPY.preferences });
}

function preferencesSection(): HTMLElement {
  return preferencesHeader()!.closest(
    '[data-testid="folded-section"]',
  ) as HTMLElement;
}

function summaryLine(): string {
  return (
    within(preferencesSection()).queryByTestId("collapsible-section-summary")
      ?.textContent || ""
  );
}

async function togglePreferences(): Promise<void> {
  await act(async () => {
    fireEvent.click(preferencesHeader()!);
  });
}

function checkbox(name: string): HTMLInputElement {
  return screen.getByRole("checkbox", {
    name: name,
    hidden: true,
  }) as HTMLInputElement;
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(element);
  });
}

function sentSubscriber(): JSONObject {
  const call: { model: unknown; requestOptions?: unknown } = (
    createOrUpdateMock.mock.calls[0] as Array<{
      model: unknown;
      requestOptions?: unknown;
    }>
  )[0]!;

  return call.model as JSONObject;
}

function sentUrl(): string {
  const call: { requestOptions?: { overrideRequestUrl?: URL } } = (
    createOrUpdateMock.mock.calls[0] as Array<{
      requestOptions?: { overrideRequestUrl?: URL };
    }>
  )[0]!;

  return call.requestOptions?.overrideRequestUrl?.toString() || "";
}

// The ids a multi-select or a picker sent, whichever shape it sent them in.
function sentIds(value: unknown): Array<string> {
  return ((value as Array<unknown>) || []).map((item: unknown): string => {
    if (item && typeof item === "object") {
      const record: Record<string, unknown> = item as Record<string, unknown>;

      return String(record["_id"] ?? record["value"] ?? record["id"] ?? "");
    }

    return String(item);
  });
}

async function typeEmail(value: string): Promise<void> {
  const email: HTMLElement = await screen.findByRole("textbox", {
    name: /^Your Email/,
  });

  await act(async () => {
    fireEvent.change(email, { target: { value: value } });
  });
}

async function pickEventType(label: string): Promise<void> {
  const picker: HTMLElement =
    within(preferencesSection()).getByRole("combobox");

  await act(async () => {
    fireEvent.focus(picker);
    fireEvent.keyDown(picker, { key: "ArrowDown", code: "ArrowDown" });
  });

  await click(await screen.findByText(label));
}

describe("Subscribing on a status page", () => {
  beforeEach(() => {
    LocalStorage.setItem("statusPageId", STATUS_PAGE_ID);
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });

    getJestSpyOn(
      SubscriberUtil,
      "getCategoryCheckboxPropsBasedOnResources",
    ).mockResolvedValue({
      categories: [],
      options: [
        { value: "checkout", label: "Checkout API", categoryId: "" },
        { value: "website", label: "Website", categoryId: "" },
      ],
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("by email, on a page that lets subscribers choose resources and event types", () => {
    test("is one page: the address, Preferences folded to what the visitor will get, and Subscribe", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });

      // No steps, so nothing to walk.
      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
      expect(nextButton()).not.toBeInTheDocument();

      // Preferences: folded, saying what the defaults do.
      expect(preferencesHeader()).toBeVisible();
      expect(preferencesHeader()).toHaveAttribute("aria-expanded", "false");
      expect(summaryLine()).toBe(COPY.everything);
      // Its line is the header's description for a screen reader too.
      expect(preferencesHeader()).toHaveAccessibleDescription(COPY.everything);
      // A line of its own, not a list of field names or a "Configured" chip.
      expect(
        within(preferencesSection()).queryAllByTestId("folded-section-item"),
      ).toHaveLength(0);
      expect(
        within(preferencesSection()).queryByTestId("folded-section-badge"),
      ).not.toBeInTheDocument();
      // Its icon tile: what the section is about.
      expect(
        within(preferencesSection()).getByTestId("folded-section-icon"),
      ).toBeInTheDocument();

      // The choices wait inside it, both ticked.
      expect(checkbox("Subscribe to All Resources")).not.toBeVisible();
      expect(checkbox("Subscribe to All Resources").checked).toBe(true);
      expect(checkbox("Subscribe to All Event Types")).not.toBeVisible();
      expect(checkbox("Subscribe to All Event Types").checked).toBe(true);

      // Subscribe: the primary colour, as wide as the card.
      const subscribe: HTMLElement = subscribeButton()!;
      expect(subscribe.className).toContain("bg-indigo-600");
      expect((subscribe.parentElement as HTMLElement).style.width).toBe("100%");
    });

    test("an address and Subscribe subscribe to everything", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await typeEmail("Reader@Example.com");
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });
      await click(subscribeButton()!);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const subscriber: JSONObject = sentSubscriber();

      expect(subscriber["subscriberEmail"]).toBe("reader@example.com");
      // What the folded, untouched Preferences send.
      expect(subscriber["isSubscribedToAllResources"]).toBe(true);
      expect(subscriber["isSubscribedToAllEventTypes"]).toBe(true);
      expect(sentIds(subscriber["statusPageResources"])).toEqual([]);
      expect(sentIds(subscriber["statusPageEventTypes"])).toEqual([]);
      expect(sentUrl()).toContain(`/subscribe/${STATUS_PAGE_ID}`);
      expect(
        await screen.findByText(/An email with the link has been sent/),
      ).toBeVisible();
    });

    test("Enter in the address subscribes: there is nothing to walk on to", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await typeEmail("reader@example.com");

      await act(async () => {
        fireEvent.keyDown(
          screen.getByRole("textbox", { name: /^Your Email/ }),
          { key: "Enter", code: "Enter" },
        );
      });

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });
      expect(sentSubscriber()["isSubscribedToAllResources"]).toBe(true);
    });

    test("Subscribe asks for the address first, and leaves Preferences folded", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });
      await click(subscribeButton()!);

      expect(await screen.findByText("Your Email is required.")).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
      // Nothing in it is wrong, so it stays out of the way.
      expect(preferencesHeader()).toHaveAttribute("aria-expanded", "false");
    });

    test("opening Preferences shows every resource and every event type ticked", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await togglePreferences();

      expect(preferencesHeader()).toHaveAttribute("aria-expanded", "true");
      expect(checkbox("Subscribe to All Resources")).toBeVisible();
      expect(checkbox("Subscribe to All Resources").checked).toBe(true);
      expect(checkbox("Subscribe to All Event Types")).toBeVisible();
      expect(checkbox("Subscribe to All Event Types").checked).toBe(true);
      // The pickers wait until an "all" box is unticked.
      expect(screen.queryByText("Checkout API")).not.toBeInTheDocument();
      expect(
        within(preferencesSection()).queryByRole("combobox"),
      ).not.toBeInTheDocument();
      // Open, the header says what the section is for instead.
      expect(
        within(preferencesSection()).getByTestId("folded-section-description")
          .textContent,
      ).toBe(COPY.description);
      expect(summaryLine()).toBe("");
    });

    test("picking resources: the line follows, and only they are subscribed to", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await typeEmail("reader@example.com");
      await togglePreferences();
      await click(checkbox("Subscribe to All Resources"));

      // Unticked with nothing picked yet: the line says so.
      expect(await screen.findByText("Checkout API")).toBeVisible();
      await togglePreferences();
      expect(summaryLine()).toBe(COPY.noResources);

      await togglePreferences();
      await click(checkbox("Checkout API"));
      await togglePreferences();
      expect(summaryLine()).toBe(COPY.pickedResources);

      await click(subscribeButton()!);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const subscriber: JSONObject = sentSubscriber();

      expect(subscriber["isSubscribedToAllResources"]).toBe(false);
      expect(sentIds(subscriber["statusPageResources"])).toEqual(["checkout"]);
      expect(subscriber["isSubscribedToAllEventTypes"]).toBe(true);
    });

    test("picking event types: the line follows, and only they are subscribed to", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await typeEmail("reader@example.com");
      await togglePreferences();
      await click(checkbox("Subscribe to All Event Types"));

      await togglePreferences();
      expect(summaryLine()).toBe(COPY.noEventTypes);

      await togglePreferences();
      await pickEventType("Incident");
      await togglePreferences();
      expect(summaryLine()).toBe(COPY.pickedEventTypes);

      await click(subscribeButton()!);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const subscriber: JSONObject = sentSubscriber();

      expect(subscriber["isSubscribedToAllEventTypes"]).toBe(false);
      expect(sentIds(subscriber["statusPageEventTypes"])).toEqual(["Incident"]);
      expect(subscriber["isSubscribedToAllResources"]).toBe(true);
    });

    test("picking both says both, and an unticked box with nothing picked says it first", async () => {
      await renderPage(EmailSubscribe, BOTH);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await togglePreferences();
      await click(checkbox("Subscribe to All Resources"));
      await click(checkbox("Subscribe to All Event Types"));

      await togglePreferences();
      expect(summaryLine()).toBe(`${COPY.noResources} ${COPY.noEventTypes}`);

      await togglePreferences();
      await click(await screen.findByText("Website"));
      await togglePreferences();
      // Event types: still nothing picked.
      expect(summaryLine()).toBe(COPY.noEventTypes);

      await togglePreferences();
      await pickEventType("Announcement");
      await togglePreferences();
      expect(summaryLine()).toBe(COPY.pickedResourcesAndEventTypes);

      // Ticking "all" again takes the line back to everything.
      await togglePreferences();
      await click(checkbox("Subscribe to All Resources"));
      await click(checkbox("Subscribe to All Event Types"));
      await togglePreferences();
      expect(summaryLine()).toBe(COPY.everything);
    });
  });

  test("by SMS: the phone number, Preferences folded, and Subscribe", async () => {
    await renderPage(SmsSubscribe, {
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: true,
    });

    await act(async () => {
      fireEvent.change(
        await screen.findByRole("textbox", { name: /^Your Phone Number/ }),
        { target: { value: "+15555550100" } },
      );
    });
    await waitFor(() => {
      expect(subscribeButton()).toBeVisible();
    });
    expect(nextButton()).not.toBeInTheDocument();
    expect(summaryLine()).toBe(COPY.everything);

    await click(subscribeButton()!);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const subscriber: JSONObject = sentSubscriber();

    expect(subscriber["subscriberPhone"]).toBe("+15555550100");
    expect(subscriber["isSubscribedToAllEventTypes"]).toBe(true);
  });

  test.each([
    {
      name: "Slack",
      Page: SlackSubscribe,
      contact: ["Slack Workspace Name", "Slack Incoming Webhook URL"],
    },
    {
      name: "Microsoft Teams",
      Page: MicrosoftTeamsSubscribe,
      contact: [
        "Microsoft Teams Workspace Name",
        "Microsoft Teams Incoming Webhook URL",
      ],
    },
    {
      name: "webhook",
      Page: WebhookSubscribe,
      contact: ["Webhook URL"],
    },
  ])(
    "by $name: one page too, with Preferences folded under the contact fields",
    async (row: {
      name: string;
      Page: SubscribePage;
      contact: Array<string>;
    }) => {
      await renderPage(row.Page, BOTH);

      for (const title of row.contact) {
        expect(
          await screen.findByRole("textbox", { name: new RegExp(`^${title}`) }),
        ).toBeVisible();
      }

      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });
      expect(nextButton()).not.toBeInTheDocument();
      expect(
        screen.queryByRole("navigation", { name: "Progress" }),
      ).not.toBeInTheDocument();
      expect(preferencesHeader()).toHaveAttribute("aria-expanded", "false");
      expect(summaryLine()).toBe(COPY.everything);

      // Preferences come after where updates go.
      const lastContact: HTMLElement = screen.getByRole("textbox", {
        name: new RegExp(`^${row.contact[row.contact.length - 1]}`),
      });
      expect(
        lastContact.compareDocumentPosition(preferencesHeader()!) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    },
  );

  test("a page that lets subscribers choose only resources folds only that choice", async () => {
    await renderPage(EmailSubscribe, {
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: false,
    });

    await screen.findByRole("textbox", { name: /^Your Email/ });
    await togglePreferences();

    expect(checkbox("Subscribe to All Resources")).toBeVisible();
    expect(
      screen.queryByRole("checkbox", {
        name: "Subscribe to All Event Types",
        hidden: true,
      }),
    ).not.toBeInTheDocument();
  });

  test("a page that lets subscribers choose nothing is the address and Subscribe", async () => {
    await renderPage(EmailSubscribe, {
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
    });

    await screen.findByRole("textbox", { name: /^Your Email/ });
    await act(async () => {});

    expect(subscribeButton()).toBeVisible();
    expect(nextButton()).not.toBeInTheDocument();
    expect(preferencesHeader()).not.toBeInTheDocument();
    expect(screen.queryByTestId("folded-section")).not.toBeInTheDocument();
  });
});
