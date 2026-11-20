import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import {
  EmailedSsoProject,
  getSsoSignInLinksEmailVariables,
  getSsoSignInLinksSubject,
  MAX_EMAILED_SSO_PROJECTS,
  SEND_SSO_SIGN_IN_LINKS_ROUTE,
  SsoSignInLinksEmailData,
} from "../../../Types/Accounts/SsoSignInLinks";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import { describe, expect, test } from "@jest/globals";

/*
 * THE EMAIL OF AN ACCOUNT'S ORGANIZATIONS' SSO SIGN-IN LINKS (#9987): the
 * variables its template is handed, and its subject. The template itself is
 * rendered in App's SsoSignInLinksTemplate.test.ts; the route and its
 * background work in App's SsoSignInLinksRoute.test.ts.
 */

const project: (index: number, url?: string) => EmailedSsoProject = (
  index: number,
  url?: string,
): EmailedSsoProject => {
  return {
    projectName: ` Project ${index} `,
    signInUrl:
      url === undefined
        ? `https://oneuptime.example.com/accounts/sso/project-${index}`
        : url,
  };
};

const data: (
  overrides?: Partial<SsoSignInLinksEmailData>,
) => SsoSignInLinksEmailData = (
  overrides?: Partial<SsoSignInLinksEmailData>,
): SsoSignInLinksEmailData => {
  return {
    productName: "OneUptime",
    projects: [project(1), project(2)],
    requestedAt: "Nov 19, 2026, 10:42 AM UTC",
    requestIpAddress: "203.0.113.7",
    requestLocation: "",
    requestDevice: "Firefox on macOS",
    ...overrides,
  };
};

const projectsOf: (
  vars: Dictionary<string | JSONObject>,
) => Array<JSONObject> = (
  vars: Dictionary<string | JSONObject>,
): Array<JSONObject> => {
  return vars["projects"] as unknown as Array<JSONObject>;
};

describe("the template's variables", () => {
  test("each project: its name, trimmed, and its link", () => {
    expect(projectsOf(getSsoSignInLinksEmailVariables(data()))).toEqual([
      {
        projectName: "Project 1",
        signInUrl: "https://oneuptime.example.com/accounts/sso/project-1",
      },
      {
        projectName: "Project 2",
        signInUrl: "https://oneuptime.example.com/accounts/sso/project-2",
      },
    ]);
  });

  test(`no more than ${MAX_EMAILED_SSO_PROJECTS} projects, and never one without a link`, () => {
    const many: Array<EmailedSsoProject> = [
      project(0, ""),
      ...Array.from({ length: 30 }, (_value: unknown, index: number) => {
        return project(index + 1);
      }),
    ];

    const listed: Array<JSONObject> = projectsOf(
      getSsoSignInLinksEmailVariables(data({ projects: many })),
    );

    expect(listed).toHaveLength(MAX_EMAILED_SSO_PROJECTS);
    expect(listed[0]!["projectName"]).toBe("Project 1");
  });

  test("where the request came from: a row only for what is known", () => {
    const vars: Dictionary<string | JSONObject> =
      getSsoSignInLinksEmailVariables(data());

    expect(vars["requestedAt"]).toBe("Nov 19, 2026, 10:42 AM UTC");
    expect(vars["requestIpAddress"]).toBe("203.0.113.7");
    expect(vars["requestDevice"]).toBe("Firefox on macOS");
    expect(vars).not.toHaveProperty("requestLocation");
  });

  test("nothing of the account but its projects: no address, no name, no id", () => {
    const vars: Dictionary<string | JSONObject> =
      getSsoSignInLinksEmailVariables(data());

    expect(Object.keys(vars).sort()).toEqual(
      [
        "productName",
        "projects",
        "requestedAt",
        "requestIpAddress",
        "requestDevice",
      ].sort(),
    );
  });
});

describe("the subject and the route", () => {
  test("the subject names the product, in the reader's language", () => {
    expect(
      getSsoSignInLinksSubject(getServerTranslator("en"), "Acme Ops"),
    ).toBe("Your Acme Ops SSO sign-in links");
    expect(
      getSsoSignInLinksSubject(getServerTranslator("fr"), "OneUptime"),
    ).toBe("Vos liens de connexion SSO OneUptime");
  });

  test("the route the Accounts page asks is the one the identity router registers", () => {
    expect(SEND_SSO_SIGN_IN_LINKS_ROUTE).toBe("/send-sso-sign-in-links");
  });
});
