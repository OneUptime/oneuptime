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
 * Subscribing to a status page by email or SMS: the visitor's address, then
 * - on a page that lets subscribers choose - a Preferences step whose
 * answers ("all resources", "every kind of event") are already ticked.
 *
 * The visitor used to click Next to that step to reach Subscribe. Now
 * Subscribe is there from the first step, under the address, with a plain
 * Next below it for anyone who wants to narrow the updates down
 * (Common/UI/Components/Forms/Utils/FinishFromAnyStep.ts). A subscription
 * made from the first step is the one Preferences would have made untouched.
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

const STATUS_PAGE_ID: string = "11111111-1111-4111-8111-111111111111";

interface PageOptions {
  allowSubscribersToChooseResources: boolean;
  allowSubscribersToChooseEventTypes: boolean;
}

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
        enableSlackSubscribers={false}
        enableMicrosoftTeamsSubscribers={false}
        enableWebhookSubscribers={false}
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

function progress(): HTMLElement {
  return screen.getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
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
      options: [{ value: "checkout", label: "Checkout API", categoryId: "" }],
    } as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  describe("by email, on a page that lets subscribers choose", () => {
    const options: PageOptions = {
      allowSubscribersToChooseResources: true,
      allowSubscribersToChooseEventTypes: true,
    };

    test("offers Subscribe on the address step, with Next below it to the preferences", async () => {
      await renderPage(EmailSubscribe, options);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });

      expect(activeStep()).toBe("Details");
      expect(within(progress()).getByText("Preferences")).toBeVisible();

      const next: HTMLElement = nextButton()!;
      expect(next).toBeVisible();
      // Under Subscribe: the form's one primary button spans the card.
      expect(
        subscribeButton()!.compareDocumentPosition(next) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    test("subscribes from the address step to every resource and every kind of event", async () => {
      await renderPage(EmailSubscribe, options);

      fireEvent.change(
        await screen.findByRole("textbox", { name: /^Your Email/ }),
        { target: { value: "Reader@Example.com" } },
      );
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });
      fireEvent.click(subscribeButton()!);

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const subscriber: JSONObject = sentSubscriber();

      expect(subscriber["subscriberEmail"]).toBe("reader@example.com");
      // What the untouched Preferences step would have sent.
      expect(subscriber["isSubscribedToAllResources"]).toBe(true);
      expect(subscriber["isSubscribedToAllEventTypes"]).toBe(true);
      expect(sentUrl()).toContain(`/subscribe/${STATUS_PAGE_ID}`);
      // Subscribed, without ever opening Preferences.
      expect(
        await screen.findByText(/An email with the link has been sent/),
      ).toBeVisible();
    });

    test("asks for the address when Subscribe is pressed without one", async () => {
      await renderPage(EmailSubscribe, options);

      await screen.findByRole("textbox", { name: /^Your Email/ });
      await waitFor(() => {
        expect(subscribeButton()).toBeVisible();
      });
      fireEvent.click(subscribeButton()!);

      expect(await screen.findByText("Your Email is required.")).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });

    test("Next still opens the preferences, where Subscribe is the only button", async () => {
      await renderPage(EmailSubscribe, options);

      fireEvent.change(
        await screen.findByRole("textbox", { name: /^Your Email/ }),
        { target: { value: "reader@example.com" } },
      );
      await waitFor(() => {
        expect(nextButton()).toBeVisible();
      });
      fireEvent.click(nextButton()!);

      await waitFor(() => {
        expect(activeStep()).toBe("Preferences");
      });
      expect(nextButton()).not.toBeInTheDocument();
      expect(subscribeButton()).toBeVisible();
      expect(createOrUpdateMock).not.toHaveBeenCalled();
    });
  });

  test("by SMS, Subscribe is on the phone number step too", async () => {
    await renderPage(SmsSubscribe, {
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: true,
    });

    fireEvent.change(
      await screen.findByRole("textbox", { name: /^Your Phone Number/ }),
      { target: { value: "+15555550100" } },
    );
    await waitFor(() => {
      expect(subscribeButton()).toBeVisible();
    });
    expect(nextButton()).toBeVisible();

    fireEvent.click(subscribeButton()!);

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const subscriber: JSONObject = sentSubscriber();

    expect(subscriber["subscriberPhone"]).toBe("+15555550100");
    expect(subscriber["isSubscribedToAllEventTypes"]).toBe(true);
  });

  test("a page that lets subscribers choose nothing is one step with Subscribe, as before", async () => {
    await renderPage(EmailSubscribe, {
      allowSubscribersToChooseResources: false,
      allowSubscribersToChooseEventTypes: false,
    });

    await screen.findByRole("textbox", { name: /^Your Email/ });
    await act(async () => {});

    expect(subscribeButton()).toBeVisible();
    expect(nextButton()).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Progress" }),
    ).not.toBeInTheDocument();
  });
});
