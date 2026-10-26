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
import { JSONObject } from "../../../Types/JSON";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import SubscriberUtil from "../../../UI/Utils/StatusPage";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * THE EMAIL SIGN-UP ON A STATUS PAGE THAT TAKES ONLY ITS PRIVATE USERS
 * (Common/Types/StatusPage/SubscriberRestrictions): the reader subscribes
 * the address they signed in with - shown, filled in and not editable - and
 * the page offers no other channel (App.tsx turns those off). Nobody is
 * signed in to a public page, so there the page can only say to sign in.
 * The server holds a sign-up to the same (StatusPageSubscribeRestrictions).
 *
 * These render the real email subscribe page; only the page chrome, the
 * network and the status page's own resources are stubbed. Copy resolves
 * against the status page's real en.json.
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
      // The page this tab shows, from where RouteMap reads it too.
      getStatusPageId: (): ObjectID | null => {
        return StatusPageInTab.get();
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
import English from "../../../../App/FeatureSet/StatusPage/src/Locales/en.json";
import ObjectID from "../../../Types/ObjectID";
import StatusPageInTab from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPageInTab";

const STATUS_PAGE_ID: string = "22222222-2222-4222-8222-222222222222";

async function renderPage(subscribeWithSignInEmail: boolean): Promise<void> {
  await act(async () => {
    render(
      <EmailSubscribe
        pageRoute={new Route("/subscribe/email")}
        onLoadComplete={(): void => {}}
        enableEmailSubscribers={true}
        enableSMSSubscribers={false}
        enableSlackSubscribers={false}
        enableMicrosoftTeamsSubscribers={false}
        enableWebhookSubscribers={false}
        allowSubscribersToChooseResources={false}
        allowSubscribersToChooseEventTypes={false}
        subscribeWithSignInEmail={subscribeWithSignInEmail}
      />,
    );
  });
}

function subscribeButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: "Subscribe" });
}

async function emailBox(): Promise<HTMLInputElement> {
  return (await screen.findByRole("textbox", {
    name: /^Your Email/,
  })) as HTMLInputElement;
}

function sentSubscriber(): JSONObject {
  const call: { model: unknown } = (
    createOrUpdateMock.mock.calls[0] as Array<{ model: unknown }>
  )[0]!;

  return call.model as JSONObject;
}

function signIn(email: string | null): void {
  if (email) {
    LocalStorage.setItem(`${STATUS_PAGE_ID}user_email`, email);
  } else {
    LocalStorage.removeItem(`${STATUS_PAGE_ID}user_email`);
  }
}

describe("Subscribing by email on a status page that takes only its private users", () => {
  beforeEach(() => {
    StatusPageInTab.set(STATUS_PAGE_ID);
    signIn(null);
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });

    getJestSpyOn(
      SubscriberUtil,
      "getCategoryCheckboxPropsBasedOnResources",
    ).mockResolvedValue({ categories: [], options: [] } as never);
  });

  afterEach(() => {
    signIn(null);
    cleanup();
    jest.restoreAllMocks();
  });

  test("the address the reader signed in with is filled in, and cannot be changed", async () => {
    signIn("reader@acme.com");

    await renderPage(true);

    const box: HTMLInputElement = await emailBox();
    expect(box.value).toBe("reader@acme.com");
    // Locked as the shared Input locks a field: read-only, greyed out.
    expect(box).toHaveAttribute("readonly");
    expect(box.className).toContain("cursor-not-allowed");
    expect(
      screen.getByText(English.subscribe.email.signedInEmailDescription),
    ).toBeInTheDocument();
  });

  test("Subscribe subscribes that address", async () => {
    signIn("reader@acme.com");

    await renderPage(true);
    await emailBox();
    await waitFor(() => {
      expect(subscribeButton()).toBeVisible();
    });

    await act(async () => {
      fireEvent.click(subscribeButton()!);
    });

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(String(sentSubscriber()["subscriberEmail"])).toBe("reader@acme.com");
  });

  test("no one signed in: no form, only what to do", async () => {
    await renderPage(true);

    expect(
      await screen.findByTestId("email-subscribe-sign-in-required"),
    ).toHaveTextContent(English.subscribe.email.signInToSubscribe);
    expect(
      screen.queryByRole("textbox", { name: /^Your Email/ }),
    ).not.toBeInTheDocument();
    expect(subscribeButton()).not.toBeInTheDocument();
    // Managing an existing subscription is still offered.
    expect(
      screen.getByText(English.subscribe.manageExisting),
    ).toBeInTheDocument();
  });

  test("a page that takes anyone asks for any address, as before, whoever is signed in", async () => {
    signIn("reader@acme.com");

    await renderPage(false);

    const box: HTMLInputElement = await emailBox();
    expect(box.value).toBe("");
    expect(box).not.toHaveAttribute("readonly");
    expect(
      screen.queryByText(English.subscribe.email.signedInEmailDescription),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("email-subscribe-sign-in-required"),
    ).not.toBeInTheDocument();
  });
});

describe("the status page's words for it", () => {
  test("are in every one of its locales, translated", () => {
    const fs: typeof import("fs") = jest.requireActual(
      "fs",
    ) as typeof import("fs");
    const path: typeof import("path") = jest.requireActual(
      "path",
    ) as typeof import("path");
    const dir: string = path.join(
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

    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json")) {
        continue;
      }

      const locale: {
        subscribe: { email: Record<string, string> };
      } = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));

      for (const key of ["signedInEmailDescription", "signInToSubscribe"]) {
        const text: string | undefined = locale.subscribe.email[key];

        expect([file, key, typeof text]).toEqual([file, key, "string"]);

        if (file !== "en.json") {
          expect([
            file,
            key,
            text === English.subscribe.email[key as "signInToSubscribe"],
          ]).toEqual([file, key, false]);
        }
      }
    }
  });
});
