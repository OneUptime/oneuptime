import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import GoogleSignInButton from "../../../../App/FeatureSet/Accounts/src/Components/GoogleSignInButton/GoogleSignInButton";
import MicrosoftSignInButton from "../../../../App/FeatureSet/Accounts/src/Components/MicrosoftSignInButton/MicrosoftSignInButton";
import {
  getSignInAttributionCookieValue,
  rememberAttributionForSignIn,
} from "../../../../App/FeatureSet/Accounts/src/Utils/SignInAttribution";
import Attribution, {
  SignUpAttribution,
} from "../../../Server/Utils/Attribution";
import { SignInAttributionCookiePath } from "../../../Types/Marketing/Attribution";

/*
 * Signing up with Google or Microsoft posts no form, so what the visitor
 * arrived with has to leave the browser some other way: either button writes
 * it into one cookie, on the path both sign-ins are under, and the callback
 * reads it through the same whitelists as a form body
 * (Attribution.fromSignInCookie).
 */

const AD_URL: string = "https://oneuptime.com/compare/pagerduty?gclid=paid";

const readBack: () => SignUpAttribution | undefined = ():
  | SignUpAttribution
  | undefined => {
  const value: string | null = getSignInAttributionCookieValue();

  return Attribution.fromSignInCookie(
    value ? decodeURIComponent(value) : undefined,
  );
};

const cookieWrites: () => Array<string> = (): Array<string> => {
  return writes;
};

let writes: Array<string> = [];

beforeEach(() => {
  window.localStorage.clear();
  writes = [];

  jest.spyOn(document, "cookie", "set").mockImplementation((value: string) => {
    writes.push(value);
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const storeTouch: () => void = (): void => {
  window.localStorage.setItem("utmSource", "google");
  window.localStorage.setItem("utmCampaign", "brand");
  window.localStorage.setItem("utmUrl", AD_URL);
  window.localStorage.setItem("clickIds", JSON.stringify({ gclid: "paid" }));
  window.localStorage.setItem(
    "firstTouch",
    JSON.stringify({ utmSource: "linkedin", landingUrl: AD_URL }),
  );
};

describe("the cookie the sign-in reads", () => {
  test("carries everything the browser holds to the server's whitelists intact", () => {
    storeTouch();

    expect(readBack()).toEqual({
      utm: { utmSource: "google", utmCampaign: "brand", utmUrl: AD_URL },
      clickIds: { gclid: "paid" },
      firstTouch: { utmSource: "linkedin", landingUrl: AD_URL },
    });
  });

  test("is nothing at all for a visitor the browser holds nothing for", () => {
    expect(getSignInAttributionCookieValue()).toBeNull();
  });

  test("never outgrows what a browser keeps, giving up the first touch first", () => {
    storeTouch();
    window.localStorage.setItem(
      "firstTouch",
      JSON.stringify({ landingUrl: "x".repeat(5000) }),
    );

    expect(getSignInAttributionCookieValue()!.length).toBeLessThan(3801);
    expect(readBack()).toMatchObject({
      utm: { utmSource: "google" },
      clickIds: { gclid: "paid" },
    });
    expect(readBack()?.firstTouch).toBeUndefined();
  });

  test("keeps the click id to the last: it is what an ad platform can use", () => {
    storeTouch();
    window.localStorage.setItem("utmContent", "x".repeat(5000));

    expect(readBack()).toMatchObject({ clickIds: { gclid: "paid" } });
  });
});

interface SignInButton {
  name: string;
  testId: string;
  route: string;
  render: (onPress?: () => void) => void;
}

const BUTTONS: Array<SignInButton> = [
  {
    name: "Continue with Google",
    testId: "google-sign-in",
    route: "/identity/google/sign-in",
    render: (onPress?: () => void): void => {
      render(
        <GoogleSignInButton title="Continue with Google" onPress={onPress} />,
      );
    },
  },
  {
    name: "Sign up with Microsoft",
    testId: "microsoft-sign-in",
    route: "/identity/microsoft/sign-in",
    render: (onPress?: () => void): void => {
      render(<MicrosoftSignInButton title="Sign up" onPress={onPress} />);
    },
  },
];

describe.each(BUTTONS)("pressing $name", (button: SignInButton) => {
  const press: (onPress?: () => void) => void = (
    onPress?: () => void,
  ): void => {
    button.render(onPress);

    const element: HTMLElement = screen.getByTestId(button.testId);

    // jsdom has no navigation to do; the link's address is pinned below.
    element.addEventListener("click", (event: Event) => {
      event.preventDefault();
    });
    fireEvent.click(element);
  };

  test("leaves the attribution where every provider's sign-in reads it, for ten minutes", () => {
    storeTouch();

    press();

    expect(cookieWrites()).toHaveLength(1);
    expect(cookieWrites()[0]).toContain("oneuptime-sign-in-attribution=");
    expect(cookieWrites()[0]).toContain("path=/identity;");
    expect(cookieWrites()[0]).toContain("max-age=600");
    expect(cookieWrites()[0]).toContain("samesite=lax");
  });

  test("takes back an earlier press's when the browser holds nothing now", () => {
    press();

    expect(cookieWrites()[0]).toContain("max-age=0");
  });

  test("is still a link to the sign-in, and tells the page", () => {
    const onPress: jest.Mock = jest.fn();

    press(onPress);

    expect(screen.getByTestId(button.testId)).toHaveAttribute(
      "href",
      button.route,
    );
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test("a cookie that cannot be written does not stop the sign-in", () => {
    const onPress: jest.Mock = jest.fn();

    jest.spyOn(document, "cookie", "set").mockImplementation(() => {
      throw new Error("Cookies are off");
    });

    expect(() => {
      rememberAttributionForSignIn();
    }).not.toThrow();

    press(onPress);

    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

/*
 * The path both providers' routes sit under: the cookie a press writes is
 * sent with either callback, and with nothing a page loads.
 */
describe("the cookie's path", () => {
  test("covers each provider's callback, and no page", () => {
    const covers: (path: string) => boolean = (path: string): boolean => {
      return path === "/identity" || path.startsWith("/identity/");
    };

    expect(SignInAttributionCookiePath).toBe("/identity");

    for (const callback of [
      "/identity/google/callback",
      "/identity/microsoft/callback",
    ]) {
      expect({ callback, covered: covers(callback) }).toEqual({
        callback,
        covered: true,
      });
    }

    for (const page of [
      "/accounts/register",
      "/accounts/login",
      "/dashboard",
    ]) {
      expect({ page, covered: covers(page) }).toEqual({
        page,
        covered: false,
      });
    }
  });
});
