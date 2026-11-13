import Analytics, { COOKIE_CONSENT_STORAGE_KEY } from "../../Utils/Analytics";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * Whether a person's use of the Dashboard may be recorded (issue #6834):
 * the consent gate of OneUptime Cloud's own session replay, built on the
 * same consent and Global Privacy Control reading as product analytics
 * (Utils/Analytics) and stricter than it - an explicit "Accept all", and
 * neither Global Privacy Control nor Do Not Track, even after a yes.
 */

const measurementWindow: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return window as unknown as Record<string, unknown>;
};

const navigatorRecord: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  return window.navigator as unknown as Record<string, unknown>;
};

const setNavigator: (key: string, value: unknown) => void = (
  key: string,
  value: unknown,
): void => {
  Object.defineProperty(window.navigator, key, {
    configurable: true,
    value: value,
  });
};

const accept: () => void = (): void => {
  window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "true");
};

describe("Analytics.isSessionRecordingAllowed", () => {
  afterEach(() => {
    delete measurementWindow()["oneUptimeProductAnalyticsDisabled"];
    delete measurementWindow()["oneUptimeConsent"];
    delete measurementWindow()["doNotTrack"];

    for (const key of ["globalPrivacyControl", "doNotTrack", "msDoNotTrack"]) {
      delete navigatorRecord()[key];
    }

    window.localStorage.clear();
    jest.restoreAllMocks();
  });

  it('records a person who pressed "Accept all", with no privacy signal', () => {
    accept();

    expect(Analytics.isSessionRecordingAllowed()).toBe(true);
  });

  it("never records a person who has not answered - unlike product analytics", () => {
    expect(Analytics.isProductAnalyticsAllowed()).toBe(true);
    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });

  it('never records a person who pressed "Reject all"', () => {
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, "false");

    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });

  it.each([
    ["granted", true],
    ["denied", false],
    ["unset", false],
  ])(
    "asks the page's consent helper first (%s)",
    (state: string, expected: boolean) => {
      // The helper wins over storage, which says the opposite here.
      window.localStorage.setItem(
        COOKIE_CONSENT_STORAGE_KEY,
        expected ? "false" : "true",
      );
      measurementWindow()["oneUptimeConsent"] = {
        state: (): string => {
          return state;
        },
      };

      expect(Analytics.isSessionRecordingAllowed()).toBe(expected);
    },
  );

  it("honours Global Privacy Control even after an acceptance", () => {
    accept();
    setNavigator("globalPrivacyControl", true);

    // Product analytics lets the acceptance win; a recording does not.
    expect(Analytics.isProductAnalyticsAllowed()).toBe(true);
    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });

  it.each([
    ["navigator.doNotTrack", "1"],
    ["navigator.doNotTrack (old Firefox)", "yes"],
    ["navigator.msDoNotTrack", "1"],
    ["window.doNotTrack", "1"],
  ])("honours Do Not Track sent as %s", (where: string, value: string) => {
    accept();

    if (where.startsWith("window")) {
      measurementWindow()["doNotTrack"] = value;
    } else {
      setNavigator(where.includes("ms") ? "msDoNotTrack" : "doNotTrack", value);
    }

    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });

  it('records when Do Not Track says "0" or nothing', () => {
    accept();
    setNavigator("doNotTrack", "0");

    expect(Analytics.isSessionRecordingAllowed()).toBe(true);

    setNavigator("doNotTrack", null);

    expect(Analytics.isSessionRecordingAllowed()).toBe(true);
  });

  it("never records on a page that measures nothing for OneUptime", () => {
    accept();
    measurementWindow()["oneUptimeProductAnalyticsDisabled"] = true;

    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });

  it("treats storage it cannot read as no answer, and so no recording", () => {
    jest
      .spyOn(Object.getPrototypeOf(window.localStorage), "getItem")
      .mockImplementation(() => {
        throw new Error("storage disabled");
      });

    expect(Analytics.isSessionRecordingAllowed()).toBe(false);
  });
});
