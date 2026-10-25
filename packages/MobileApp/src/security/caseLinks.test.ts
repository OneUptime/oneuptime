import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  isUuid,
  looksLikeSecurityCaseLink,
  parseSecurityCaseLink,
} from "./caseLinks";

/*
 * A link to a security case in the dashboard opens the case in the app - the
 * alert a playbook paged with and an incident declared from a case name
 * their case that way. Only a link to the OneUptime the app is signed in to
 * counts, compared as parsed URLs and never as text: a lookalike host, a
 * host that merely starts or ends like the server's, or a path that only
 * resembles a case's stays a link for the browser.
 */

const PROJECT_ID: string = "0b5e55ed-aaaa-4aaa-8aaa-00000000a0a0";
const CASE_ID: string = "5ec0ca5e-0142-4d1a-9a00-000000000142";
const SERVER: string = "https://oneuptime.example.com";
const CASE_LINK: string = `${SERVER}/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`;

describe("a link to a case on this OneUptime", () => {
  test("names its project and case", () => {
    expect(parseSecurityCaseLink(CASE_LINK, SERVER)).toEqual({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
    });
  });

  test("so does a link to one of the case's own pages", () => {
    for (const page of ["timeline", "detections", "playbook-runs/"]) {
      expect(parseSecurityCaseLink(`${CASE_LINK}/${page}`, SERVER)).toEqual({
        projectId: PROJECT_ID,
        caseId: CASE_ID,
      });
    }
  });

  test("a query string or a fragment changes nothing", () => {
    expect(
      parseSecurityCaseLink(`${CASE_LINK}?tab=notes#latest`, SERVER),
    ).toEqual({ projectId: PROJECT_ID, caseId: CASE_ID });
  });

  test("the server address may end in a slash, or be typed with capitals", () => {
    expect(parseSecurityCaseLink(CASE_LINK, `${SERVER}/`)).not.toBeNull();
    expect(
      parseSecurityCaseLink(CASE_LINK, "https://OneUptime.Example.com"),
    ).not.toBeNull();
  });

  test("a OneUptime served under a path of its own is read past that path", () => {
    const server: string = "https://example.com/oneuptime";

    expect(
      parseSecurityCaseLink(
        `https://example.com/oneuptime/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
        server,
      ),
    ).toEqual({ projectId: PROJECT_ID, caseId: CASE_ID });
    expect(
      parseSecurityCaseLink(
        `https://example.com/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
        server,
      ),
    ).toBeNull();
  });

  test("a self-hosted OneUptime on a port of its own counts on that port only", () => {
    const server: string = "https://oneuptime.internal:8443";

    expect(
      parseSecurityCaseLink(
        `https://oneuptime.internal:8443/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
        server,
      ),
    ).not.toBeNull();
    expect(
      parseSecurityCaseLink(
        `https://oneuptime.internal/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
        server,
      ),
    ).toBeNull();
  });
});

describe("a link that stays a link", () => {
  test.each([
    ["another OneUptime", `https://oneuptime.com/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["a lookalike host that starts like the server", `https://oneuptime.example.com.evil.test/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["a lookalike host that ends like the server", `https://evil-oneuptime.example.com/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["the server's address hidden in the user part", `https://oneuptime.example.com@evil.test/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["plain http to an https server", `http://oneuptime.example.com/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["an incident", `${SERVER}/dashboard/${PROJECT_ID}/incidents/${CASE_ID}`],
    ["the case list", `${SERVER}/dashboard/${PROJECT_ID}/security-events/cases`],
    ["a case id that is not a uuid", `${SERVER}/dashboard/${PROJECT_ID}/security-events/cases/CASE-142`],
    ["a project id that is not a uuid", `${SERVER}/dashboard/acme/security-events/cases/${CASE_ID}`],
    ["a path outside the dashboard", `${SERVER}/status-page/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["another scheme", `oneuptime://dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`],
    ["a mail link", "mailto:soc@example.test"],
    ["text that is not a link at all", "see the case"],
  ])("%s", (_name: string, href: string) => {
    expect(parseSecurityCaseLink(href, SERVER)).toBeNull();
  });

  test("nothing to read reads as nothing", () => {
    expect(parseSecurityCaseLink(undefined, SERVER)).toBeNull();
    expect(parseSecurityCaseLink(CASE_LINK, null)).toBeNull();
    expect(parseSecurityCaseLink("", SERVER)).toBeNull();
    expect(parseSecurityCaseLink(CASE_LINK, "not a server")).toBeNull();
  });
});

describe("the quick look before reading the server address", () => {
  test("says yes to a case link on any server, and to its pages", () => {
    expect(looksLikeSecurityCaseLink(CASE_LINK)).toBe(true);
    expect(looksLikeSecurityCaseLink(`${CASE_LINK}/timeline`)).toBe(true);
    expect(
      looksLikeSecurityCaseLink(
        `https://example.com/oneuptime/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
      ),
    ).toBe(true);
  });

  test("says no to everything else, so those links open at once", () => {
    for (const href of [
      "https://example.com/runbook",
      `${SERVER}/dashboard/${PROJECT_ID}/incidents/${CASE_ID}`,
      "mailto:soc@example.test",
      "tel:+15550100",
      `oneuptime://dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
      "",
    ]) {
      expect({ href, looks: looksLikeSecurityCaseLink(href) }).toEqual({
        href,
        looks: false,
      });
    }
    expect(looksLikeSecurityCaseLink(undefined)).toBe(false);
  });
});

describe("on React Native's own URL, which a handset runs", () => {
  /*
   * React Native ships its own URL (Libraries/Blob/URL): it parses with
   * patterns, keeps a host as it was written, and accepts any text without
   * throwing. The links are read on it the same way.
   */
  const realUrl: typeof URL = global.URL;

  beforeAll(() => {
    const { URL: ReactNativeUrl } = jest.requireActual<{
      URL: typeof URL;
    }>("react-native/Libraries/Blob/URL");
    global.URL = ReactNativeUrl;
  });

  afterAll(() => {
    global.URL = realUrl;
  });

  test("a case link on this OneUptime names its case", () => {
    expect(parseSecurityCaseLink(`${CASE_LINK}/timeline`, SERVER)).toEqual({
      projectId: PROJECT_ID,
      caseId: CASE_ID,
    });
    expect(
      parseSecurityCaseLink(CASE_LINK, "https://OneUptime.Example.com/"),
    ).not.toBeNull();
  });

  test("lookalikes and other servers stay links", () => {
    for (const href of [
      `https://oneuptime.example.com.evil.test/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
      `https://oneuptime.example.com@evil.test/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
      `https://oneuptime.com/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
      "see the case",
    ]) {
      expect({ href, link: parseSecurityCaseLink(href, SERVER) }).toEqual({
        href,
        link: null,
      });
    }
  });

  test("the quick look agrees", () => {
    expect(looksLikeSecurityCaseLink(CASE_LINK)).toBe(true);
    expect(looksLikeSecurityCaseLink("see the case")).toBe(false);
  });
});

describe("ids", () => {
  test("a uuid in either case is an id; anything else is not", () => {
    expect(isUuid(CASE_ID)).toBe(true);
    expect(isUuid(CASE_ID.toUpperCase())).toBe(true);
    expect(isUuid(`${CASE_ID}0`)).toBe(false);
    expect(isUuid(` ${CASE_ID}`)).toBe(false);
    expect(isUuid("CASE-142")).toBe(false);
    expect(isUuid(null)).toBe(false);
  });

  test("checking one takes no longer for a long text than a short one", () => {
    const long: string = "a".repeat(400000);
    const started: number = Date.now();

    expect(isUuid(long)).toBe(false);
    expect(looksLikeSecurityCaseLink(`https://example.com/${long}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
