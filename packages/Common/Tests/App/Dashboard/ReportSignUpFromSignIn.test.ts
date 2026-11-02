import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import reportSignUpFromSignIn from "../../../../App/FeatureSet/Dashboard/src/Utils/ReportSignUpFromSignIn";
import { RevenueEventName } from "../../../Types/Analytics/RevenueEvent";
import Email from "../../../Types/Email";
import UiAnalytics from "../../../UI/Utils/Analytics";
import UserUtil from "../../../UI/Utils/User";

/*
 * A sign-in that made a new account ends on the Dashboard, marked on the
 * address. That is the one place left to report the sign-up from: the sign-up
 * page's reporting never ran, and it is the funnel's first conversion.
 */

const EMAIL: Email = new Email("buyer@acme.example");

const visit: (address: string) => void = (address: string): void => {
  window.history.replaceState({}, "", address);
};

let captureRevenueEvent: jest.SpyInstance;
let userAuth: jest.SpyInstance;
let getEmail: jest.SpyInstance;

beforeEach(() => {
  captureRevenueEvent = jest
    .spyOn(UiAnalytics, "captureRevenueEvent")
    .mockImplementation(() => {});
  userAuth = jest.spyOn(UiAnalytics, "userAuth").mockImplementation(() => {});
  getEmail = jest.spyOn(UserUtil, "getEmail").mockReturnValue(EMAIL);
});

afterEach(() => {
  jest.restoreAllMocks();
  visit("/");
});

describe("a sign-in that made an account", () => {
  test("reports one sign_up, and says who this is", () => {
    visit("/dashboard?signed_up_with=microsoft");

    reportSignUpFromSignIn();

    expect(captureRevenueEvent).toHaveBeenCalledTimes(1);
    expect(captureRevenueEvent).toHaveBeenCalledWith(
      RevenueEventName.SignupCompleted,
      { funnel_stage: "signup", signup_method: "microsoft" },
    );
    expect(userAuth).toHaveBeenCalledWith(EMAIL);
  });

  test("takes the mark off the address, so a reload reports nothing", () => {
    visit("/dashboard?signed_up_with=microsoft");

    reportSignUpFromSignIn();
    reportSignUpFromSignIn();

    expect(window.location.pathname + window.location.search).toBe(
      "/dashboard",
    );
    expect(captureRevenueEvent).toHaveBeenCalledTimes(1);
  });

  test("leaves the rest of the address as it was", () => {
    visit("/dashboard?tab=one&signed_up_with=microsoft#section");

    reportSignUpFromSignIn();

    expect(
      window.location.pathname + window.location.search + window.location.hash,
    ).toBe("/dashboard?tab=one#section");
  });

  test("reports nothing when nobody turned out to be signed in", () => {
    getEmail.mockReturnValue(null);
    visit("/dashboard?signed_up_with=microsoft");

    reportSignUpFromSignIn();

    expect(captureRevenueEvent).not.toHaveBeenCalled();
  });

  test("reports a sign-up with Google as Google's", () => {
    visit("/dashboard?signed_up_with=google");

    reportSignUpFromSignIn();

    expect(captureRevenueEvent).toHaveBeenCalledTimes(1);
    expect(captureRevenueEvent).toHaveBeenCalledWith(
      RevenueEventName.SignupCompleted,
      { funnel_stage: "signup", signup_method: "google" },
    );
    expect(userAuth).toHaveBeenCalledWith(EMAIL);
    expect(window.location.pathname + window.location.search).toBe(
      "/dashboard",
    );
  });

  /*
   * The server marks only the providers that sign people up; anything else
   * on the address is a link someone wrote, and is not a sign-up method.
   */
  test.each(["", "github", "Google", "microsoft,google"])(
    "takes %p off the address, and reports nothing",
    (value: string) => {
      visit(`/dashboard?tab=one&signed_up_with=${encodeURIComponent(value)}`);

      reportSignUpFromSignIn();

      expect(captureRevenueEvent).not.toHaveBeenCalled();
      expect(userAuth).not.toHaveBeenCalled();
      expect(window.location.pathname + window.location.search).toBe(
        "/dashboard?tab=one",
      );
    },
  );
});

describe("every other visit to the Dashboard", () => {
  test.each(["/dashboard", "/dashboard?tab=one"])(
    "%s reports nothing and changes nothing",
    (address: string) => {
      visit(address);

      reportSignUpFromSignIn();

      expect(captureRevenueEvent).not.toHaveBeenCalled();
      expect(userAuth).not.toHaveBeenCalled();
      expect(window.location.pathname + window.location.search).toBe(address);
    },
  );
});
