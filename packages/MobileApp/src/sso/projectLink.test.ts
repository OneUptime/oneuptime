import {
  parseProjectSsoSignInLink,
  type ProjectSsoSignInLink,
} from "./projectLink";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROJECT'S SSO SIGN-IN LINK, PASTED ON THE APP'S SSO SCREEN (#9989).
 *
 * The link an admin shares - https://<server>/accounts/sso/<project id> -
 * names the project whose providers the app then lists. What matters here is
 * what the app makes of whatever is pasted: the project, only on the server
 * the app signs in to, and a reason for anything else. Every test runs on
 * iOS and on Android.
 */

const SERVER: string = "https://oneuptime.com";
const PROJECT_ID: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

describe("A project's SSO sign-in link on this server", () => {
  test.each([
    ["as the Dashboard copies it", `${SERVER}/accounts/sso/${PROJECT_ID}`],
    ["with a trailing slash", `${SERVER}/accounts/sso/${PROJECT_ID}/`],
    ["with spaces around it", `  ${SERVER}/accounts/sso/${PROJECT_ID}\n`],
    [
      "with a query and a fragment",
      `${SERVER}/accounts/sso/${PROJECT_ID}?utm_source=email#top`,
    ],
    [
      "in capitals",
      `HTTPS://OneUptime.COM/accounts/sso/${PROJECT_ID.toUpperCase()}`,
    ],
    [
      "with the default port",
      `https://oneuptime.com:443/accounts/sso/${PROJECT_ID}`,
    ],
  ])("names its project %s", (_label: string, pasted: string) => {
    expect(parseProjectSsoSignInLink(pasted, SERVER)).toEqual({
      status: "link",
      projectId: PROJECT_ID,
    });
  });

  test("on a self-hosted server, with its port", () => {
    const selfHosted: string = "http://oneuptime.acme.internal:8080/";

    expect(
      parseProjectSsoSignInLink(
        `http://oneuptime.acme.internal:8080/accounts/sso/${PROJECT_ID}`,
        selfHosted,
      ),
    ).toEqual({ status: "link", projectId: PROJECT_ID });
  });
});

describe("A link that names no project", () => {
  test.each([
    ["the page with no id", `${SERVER}/accounts/sso`],
    ["the page with a slash and no id", `${SERVER}/accounts/sso/`],
    ["an id that is not one", `${SERVER}/accounts/sso/acme`],
    ["half an id", `${SERVER}/accounts/sso/${PROJECT_ID.slice(0, 18)}`],
    ["an escaped id that is not one", `${SERVER}/accounts/sso/%E0%A4%A`],
  ])("says so: %s", (_label: string, pasted: string) => {
    expect(parseProjectSsoSignInLink(pasted, SERVER)).toEqual({
      status: "no-project",
    });
  });
});

describe("Something else pasted", () => {
  test.each([
    ["nothing", ""],
    ["an email address", "responder@acme.com"],
    ["a bare project id", PROJECT_ID],
    ["the sign-in page", `${SERVER}/accounts/login`],
    ["a dashboard page", `${SERVER}/dashboard/${PROJECT_ID}/sso`],
    ["a deeper path", `${SERVER}/accounts/sso/${PROJECT_ID}/extra`],
    ["another scheme", `ftp://oneuptime.com/accounts/sso/${PROJECT_ID}`],
    ["the app's own deep link", "oneuptime://sso-callback?code=abc&state=def"],
    [
      "credentials in the address",
      `https://user:pass@oneuptime.com/accounts/sso/${PROJECT_ID}`,
    ],
  ])("is not a link: %s", (_label: string, pasted: string) => {
    expect(parseProjectSsoSignInLink(pasted, SERVER)).toEqual({
      status: "not-a-link",
    });
  });
});

describe("A project's link on another server", () => {
  test.each([
    ["another host", `https://acme.oneuptime.dev/accounts/sso/${PROJECT_ID}`],
    [
      "a host that only starts the same",
      `https://oneuptime.com.evil.example/accounts/sso/${PROJECT_ID}`,
    ],
    ["plain http", `http://oneuptime.com/accounts/sso/${PROJECT_ID}`],
    ["another port", `https://oneuptime.com:8443/accounts/sso/${PROJECT_ID}`],
  ])(
    "is not taken - the app signs in to its own server alone: %s",
    (_label: string, pasted: string) => {
      const parsed: ProjectSsoSignInLink = parseProjectSsoSignInLink(
        pasted,
        SERVER,
      );

      expect(parsed.status).toBe("other-server");
    },
  );

  test("names the server it is for", () => {
    expect(
      parseProjectSsoSignInLink(
        `https://Status.Acme.com/accounts/sso/${PROJECT_ID}`,
        SERVER,
      ),
    ).toEqual({
      status: "other-server",
      serverOrigin: "https://status.acme.com",
    });
  });
});
