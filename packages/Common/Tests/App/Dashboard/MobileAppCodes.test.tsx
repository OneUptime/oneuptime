import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

/*
 * A code as what it leads to: the store's address. What it is told to do
 * when it cannot be drawn is kept, by address, for a test to call.
 */
const mockCodeFailures: Map<string, () => void> = new Map();

jest.mock("../../../UI/Components/QR/QR", () => {
  return {
    __esModule: true,
    default: (props: { text: string; onError?: () => void }) => {
      if (props.onError) {
        mockCodeFailures.set(props.text, props.onError);
      }

      return <span data-testid="qr-code" data-text={props.text} />;
    },
  };
});
import MobileAppCodes, {
  MOBILE_APP_INSTALL_FROM_OWN_PAGE_ON_PHONE_SENTENCE,
  MOBILE_APP_INSTALL_FROM_OWN_PAGE_SENTENCE,
  MOBILE_APP_INSTALL_ON_PHONE_SENTENCE,
  MOBILE_APP_INSTALL_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MobileAppCodes";
import {
  HelpChoice,
  HelpItem,
} from "../../../Types/HelpAndSupport/HelpAndSupport";
import {
  forgetHelpAndSupport,
  helpAndSupportWith,
  setHelpAndSupportEnvironment,
  setSignedInHelpAndSupport,
} from "../../Helpers/HelpAndSupportEnvironment";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";

/*
 * GET THE MOBILE APP (MobileAppCodes): a laptop shows a code per store, a
 * phone the two links alone - the phone is where the app goes. How to Reach
 * Me's "Get the app" (#7451), drawn at a phone's width by its browser suite
 * (packages/E2E/HowToReachMe), asked that phone to scan a code it did not
 * show, and broke the server's address mid-word ("ht" / "tp://localhost").
 *
 * jsdom draws no widths, so this holds what the widths are drawn from: each
 * sentence is shown at its own, and the address is never broken anywhere.
 * The browser suite checks what is seen at 1280 and 390.
 */

afterEach(() => {
  cleanup();
  forgetHelpAndSupport();
  mockCodeFailures.clear();
});

const renderCodes: () => HTMLElement = (): HTMLElement => {
  render(
    <MobileAppCodes
      dataTestId="app-codes"
      serverUrlDataTestId="app-server-url"
    />,
  );

  return screen.getByTestId("app-codes");
};

// The sentence that names the address with this test id.
const sentenceWith: (serverUrlTestId: string) => HTMLElement = (
  serverUrlTestId: string,
): HTMLElement => {
  return screen.getByTestId(serverUrlTestId).closest("p") as HTMLElement;
};

describe("the mobile app's codes", () => {
  test("a code for each store, hidden on a phone, beside each store's link", () => {
    const codes: HTMLElement = renderCodes();

    expect(
      Array.from(codes.querySelectorAll('[data-testid="qr-code"]')).map(
        (code: Element): string | null => {
          return code.getAttribute("data-text");
        },
      ),
    ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);
    expect(
      Array.from(codes.querySelectorAll("a")).map(
        (link: HTMLAnchorElement): string => {
          return link.getAttribute("href") || "";
        },
      ),
    ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);

    for (const code of Array.from(
      codes.querySelectorAll('[data-testid="qr-code"]'),
    )) {
      expect(code.parentElement).toHaveClass("max-sm:hidden");
    }
  });

  test("a laptop is asked to scan a code; a phone, which shows none, is sent to the stores", () => {
    renderCodes();

    const laptop: HTMLElement = sentenceWith("app-server-url");
    const phone: HTMLElement = sentenceWith("app-server-url-on-phone");

    expect(laptop).not.toBe(phone);
    expect(laptop).toHaveClass("max-sm:hidden");
    expect(laptop).not.toHaveClass("sm:hidden");
    expect(phone).toHaveClass("sm:hidden");
    expect(phone).not.toHaveClass("max-sm:hidden");

    // Each says its own sentence, the server's address in its place.
    expect(laptop.textContent).toMatch(/^Scan a code with your phone/);
    expect(phone.textContent).toMatch(
      /^Install the app from the App Store or Google Play/,
    );
    expect(MOBILE_APP_INSTALL_SENTENCE).toContain("{{serverUrl}}");
    expect(MOBILE_APP_INSTALL_ON_PHONE_SENTENCE).toContain("{{serverUrl}}");
  });

  /*
   * A code that could not be drawn says so in its place (QR), and is no
   * code to scan: "Scan a code with your phone" beside it said the opposite
   * (#6653). The laptop is then told what a phone is, the store links under
   * each code being there either way.
   */
  test.each([
    ["the App Store's", [MOBILE_APP_IOS_URL]],
    ["Google Play's", [MOBILE_APP_ANDROID_URL]],
    ["both", [MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]],
  ])(
    "when %s code cannot be drawn, a laptop is sent to the stores too, never asked to scan",
    (_name: string, failed: Array<string>) => {
      const codes: HTMLElement = renderCodes();

      for (const address of failed) {
        act(() => {
          mockCodeFailures.get(address)!();
        });
      }

      const laptop: HTMLElement = sentenceWith("app-server-url");

      expect(laptop.textContent).toMatch(
        /^Install the app from the App Store or Google Play/,
      );
      expect(laptop.textContent).not.toMatch(/Scan/);
      // Still the laptop's sentence: shown from a laptop's width.
      expect(laptop).toHaveClass("max-sm:hidden");
      // And the store links, the way in, stay.
      expect(
        Array.from(codes.querySelectorAll("a")).map(
          (link: HTMLAnchorElement): string => {
            return link.getAttribute("href") || "";
          },
        ),
      ).toEqual([MOBILE_APP_IOS_URL, MOBILE_APP_ANDROID_URL]);
    },
  );

  test("the address reads left to right, and is never broken mid-word", () => {
    renderCodes();

    for (const id of ["app-server-url", "app-server-url-on-phone"]) {
      const address: HTMLElement = screen.getByTestId(id);

      expect(address.textContent).toMatch(/^https?:\/\//);
      expect(address).toHaveAttribute("dir", "ltr");
      expect(address).toHaveClass("break-words");
      expect(address).not.toHaveClass("break-all");
    }
  });
});

/*
 * How the server's admins offer the app (Admin Dashboard > Settings > Help
 * and Support, #10866): OneUptime's stores by default, a page of their own -
 * an app catalogue, a device manager's company portal - or not at all.
 */
describe("the mobile app, as the server's admins offer it", () => {
  const OWN_PAGE: string = "https://apps.example.com/catalog/oneuptime-on-call";

  const fromOwnPage: () => void = (): void => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: { choice: HelpChoice.Link, value: OWN_PAGE },
      }),
    );
  };

  test("turned off: nothing is drawn", () => {
    setSignedInHelpAndSupport(
      helpAndSupportWith({
        [HelpItem.MobileApp]: { choice: HelpChoice.Hidden, value: null },
      }),
    );

    const { container } = render(
      <MobileAppCodes
        dataTestId="app-codes"
        serverUrlDataTestId="app-server-url"
      />,
    );

    expect(screen.queryByTestId("app-codes")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("from the server's own page: one code for it, named by its address, and no store", () => {
    fromOwnPage();

    const codes: HTMLElement = renderCodes();
    const ownPage: HTMLElement = screen.getByTestId("app-codes-own-page");

    expect(
      Array.from(codes.querySelectorAll('[data-testid="qr-code"]')).map(
        (code: Element): string | null => {
          return code.getAttribute("data-text");
        },
      ),
    ).toEqual([OWN_PAGE]);

    const link: HTMLAnchorElement = ownPage.querySelector(
      "a",
    ) as HTMLAnchorElement;

    expect(link).toHaveAttribute("href", OWN_PAGE);
    expect(link).toHaveTextContent("apps.example.com");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    // An address reads left to right, and breaks rather than run off a phone.
    expect(link).toHaveAttribute("dir", "ltr");
    expect(link).toHaveClass("break-all");
    expect(codes).not.toHaveTextContent("App Store");
    expect(codes).not.toHaveTextContent("Google Play");
  });

  test("from the server's own page: each sentence says to get the app from the organization, the server's address in its place", () => {
    fromOwnPage();
    renderCodes();

    expect(sentenceWith("app-server-url").textContent).toMatch(
      /^Scan the code with your phone to get the app from your organization, sign in to https?:\/\//,
    );
    expect(sentenceWith("app-server-url-on-phone").textContent).toMatch(
      /^Get the app from the link above, sign in to https?:\/\//,
    );
    expect(MOBILE_APP_INSTALL_FROM_OWN_PAGE_SENTENCE).toContain(
      "{{serverUrl}}",
    );
    expect(MOBILE_APP_INSTALL_FROM_OWN_PAGE_ON_PHONE_SENTENCE).toContain(
      "{{serverUrl}}",
    );
  });

  test("from the server's own page, a code that cannot be drawn sends a laptop to the link, never asking it to scan", () => {
    fromOwnPage();
    renderCodes();

    act(() => {
      mockCodeFailures.get(OWN_PAGE)!();
    });

    const laptop: HTMLElement = sentenceWith("app-server-url");

    expect(laptop.textContent).toMatch(/^Get the app from the link above/);
    expect(laptop.textContent).not.toMatch(/Scan/);
    expect(laptop).toHaveClass("max-sm:hidden");
  });

  test("a page of the server's own not read from the server yet: nothing, rather than OneUptime's stores", () => {
    // env.js says the server has a page of its own, and holds its address back.
    setHelpAndSupportEnvironment(
      helpAndSupportWith({
        [HelpItem.MobileApp]: { choice: HelpChoice.Link, value: OWN_PAGE },
      }),
    );

    render(
      <MobileAppCodes
        dataTestId="app-codes"
        serverUrlDataTestId="app-server-url"
      />,
    );

    expect(screen.queryByTestId("app-codes")).toBeNull();
    expect(screen.queryByText("App Store")).toBeNull();
  });
});
