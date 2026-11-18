import { afterEach, describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";

// A code as what it leads to: the store's address.
jest.mock("../../../UI/Components/QR/QR", () => {
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return <span data-testid="qr-code" data-text={props.text} />;
    },
  };
});
import MobileAppCodes, {
  MOBILE_APP_INSTALL_ON_PHONE_SENTENCE,
  MOBILE_APP_INSTALL_SENTENCE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MobileAppCodes";
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
