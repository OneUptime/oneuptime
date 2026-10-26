import StatusPageUtil from "../../../../App/FeatureSet/StatusPage/src/Utils/StatusPage";
import { beforeEach, describe, expect, test } from "@jest/globals";

type SetUrlFunction = (url: string) => void;

const setUrl: SetUrlFunction = (url: string): void => {
  window.history.replaceState(window.history.state, "", url);
};

const setRedirectUrl: (redirectUrl: string | null) => void = (
  redirectUrl: string | null,
): void => {
  setUrl(
    redirectUrl === null
      ? "/login"
      : `/login?redirectUrl=${encodeURIComponent(redirectUrl)}`,
  );
};

describe("Status Page redirect safety", () => {
  beforeEach(() => {
    setUrl("/login");
  });

  describe("getSafeRedirectPath", () => {
    test.each([
      "/",
      "/incidents/incident-id",
      "/scheduled-maintenance/event-id?tab=timeline#note",
      "/status-page/status-page-id/incidents/incident-id",
      "/incidents?next=https://evil.example/path",
      "/literal/javascript:alert(1)",
    ])("accepts same-origin application path %s", (redirectPath: string) => {
      expect(StatusPageUtil.getSafeRedirectPath(redirectPath)).toBe(
        redirectPath,
      );
    });

    test.each([
      null,
      "",
      "incidents/incident-id",
      "?tab=timeline",
      "#note",
      "javascript:alert(document.domain)",
      "JaVaScRiPt:alert(1)",
      "data:text/plain,hello",
      "http:/evil.example/path",
      "http://evil.example/path",
      "https://evil.example/path",
      "//evil.example/path",
      "///evil.example/path",
      "\\evil.example/path",
      "/\\evil.example/path",
      '/"',
      "/☃",
      "/\u0000control",
    ])("rejects unsafe redirect target %s", (redirectPath: string | null) => {
      expect(StatusPageUtil.getSafeRedirectPath(redirectPath)).toBeNull();
    });

    test("rejects an absolute URL on the current origin", () => {
      expect(
        StatusPageUtil.getSafeRedirectPath(
          `${window.location.origin}/incidents/incident-id`,
        ),
      ).toBeNull();
    });

    test.each([
      "/login",
      "/LOGIN?next=/incidents/incident-id",
      "/login#sign-in",
      "/status-page/status-page-id/sso",
      "/status-page/status-page-id/sso#provider",
      "/master-password?redirectUrl=/incidents/incident-id",
      "/status-page/status-page-id/forgot-password",
      "/reset-password#token",
    ])("rejects authentication-loop path %s", (redirectPath: string) => {
      expect(StatusPageUtil.getSafeRedirectPath(redirectPath)).toBeNull();
    });
  });

  describe("getSafeRedirectUrl", () => {
    test("reads and percent-decodes a safe redirect query value", () => {
      const redirectPath: string =
        "/scheduled-maintenance/event-id?tab=timeline#note";

      setRedirectUrl(redirectPath);

      expect(StatusPageUtil.getSafeRedirectUrl()).toBe(redirectPath);
    });

    test.each([
      "javascript:alert(document.domain)",
      "//evil.example/path",
      "/\\evil.example/path",
    ])(
      "rejects percent-encoded unsafe redirect query value %s",
      (redirectPath: string) => {
        setRedirectUrl(redirectPath);

        expect(StatusPageUtil.getSafeRedirectUrl()).toBeNull();
      },
    );

    test("returns null when redirectUrl is missing", () => {
      setRedirectUrl(null);

      expect(StatusPageUtil.getSafeRedirectUrl()).toBeNull();
    });

    test("returns null when redirectUrl is present but empty", () => {
      setUrl("/login?redirectUrl=");

      expect(StatusPageUtil.getSafeRedirectUrl()).toBeNull();
    });
  });

  /*
   * Moving between the page's two ways in - the password form and single
   * sign-on - keeps where the visitor is going once signed in, and only
   * ever a safe place on the page itself.
   */
  describe("getSignInRoute", () => {
    test("carries a safe redirect along", () => {
      expect(
        StatusPageUtil.getSignInRoute({
          path: "/sso",
          redirectUrl: "/incidents/incident-id?tab=timeline",
        }).toString(),
      ).toBe(
        `/sso?redirectUrl=${encodeURIComponent("/incidents/incident-id?tab=timeline")}`,
      );
    });

    test("is the bare page without one", () => {
      expect(
        StatusPageUtil.getSignInRoute({
          path: "/login",
          redirectUrl: null,
        }).toString(),
      ).toBe("/login");
    });

    test.each([
      "https://evil.example/path",
      "//evil.example/path",
      "javascript:alert(1)",
      // A sign-in page is never where a sign-in lands.
      "/login",
      "/sso",
    ])("drops an unsafe or sign-in redirect %s", (redirectUrl: string) => {
      expect(
        StatusPageUtil.getSignInRoute({
          path: "/login",
          redirectUrl: redirectUrl,
        }).toString(),
      ).toBe("/login");
    });

    test("keeps the preview's own path", () => {
      expect(
        StatusPageUtil.getSignInRoute({
          path: "/status-page/status-page-id/login",
          redirectUrl: "/status-page/status-page-id/incidents/incident-id",
        }).toString(),
      ).toBe(
        `/status-page/status-page-id/login?redirectUrl=${encodeURIComponent(
          "/status-page/status-page-id/incidents/incident-id",
        )}`,
      );
    });
  });
});
