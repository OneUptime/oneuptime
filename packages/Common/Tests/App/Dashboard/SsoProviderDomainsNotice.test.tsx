import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import Domain from "../../../Models/DatabaseModels/Domain";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import DomainType from "../../../Types/Domain";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import ProjectSsoCopy, {
  PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID,
  SSO_PROVIDER_DOMAINS_TEST_ID,
  SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/ProjectSsoCopy";
import ProjectSsoSignInLinkCard, {
  getProjectSsoSignInLink,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/ProjectSsoSignInLinkCard";
import {
  getProviderName,
  getProvidersNotFoundByEmail,
  getVerifiedDomains,
  isFoundByEmail,
  SSO_PROVIDER_DOMAINS_SELECT,
  SsoProviderDomainsRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoProviderDomains";
import SsoProviderDomainsElement from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoProviderDomainsElement";
import SsoProvidersNotOfferedNotice, {
  SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Sso/SsoProvidersNotOfferedNotice";

/*
 * SETTINGS > SSO SAYS WHICH PROVIDERS "SIGN IN WITH SSO" FINDS BY NOBODY'S
 * EMAIL, AND HOW TO FIX IT (#9918).
 *
 * "Sign in with SSO" finds a project's SAML or OIDC provider by an address's
 * verified domain alone (#9824). One that lists no verified domain is found
 * by nobody's email: after the upgrade, a provider whose project had no
 * verified domain of its own to give it; or one added since with none
 * picked. Settings > SSO now says so plainly:
 *
 *   - each provider's Domains column: its verified domains, a domain it
 *     lists that is not verified, or "No verified domain";
 *   - a notice over the cards naming the providers that are on and found by
 *     no email, and what to do: pick a domain under Domains, or - while the
 *     project has no verified domain at all - Verify a Domain first, which
 *     opens Project Settings > Domains;
 *   - the SSO Sign-in Link card: the project's link, to share with people
 *     "Sign in with SSO" cannot find a provider for, and to test with.
 *
 * The real components run here; ModelAPI.getList answers the notice's
 * reads, and Navigation.navigate records where Verify a Domain goes.
 */

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;
  const url: { default: { fromString: (value: string) => unknown } } =
    jest.requireActual("../../../Types/API/URL") as {
      default: { fromString: (value: string) => unknown };
    };

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "ACCOUNTS_URL", {
    get: (): unknown => {
      return url.default.fromString("https://oneuptime.example.com/accounts");
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const DASHBOARD_LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const english: Record<string, string> = readLocale("en");
const german: Record<string, string> = readLocale("de");
const persian: Record<string, string> = readLocale("fa");

const domain: (name: string, isVerified: boolean) => Domain = (
  name: string,
  isVerified: boolean,
): Domain => {
  const row: Domain = new Domain();
  row._id = ObjectID.generate().toString();
  row.domain = new DomainType(name);
  row.isVerified = isVerified;
  return row;
};

const saml: (data: {
  name: string;
  isEnabled: boolean;
  domains: Array<Domain>;
}) => ProjectSSO = (data: {
  name: string;
  isEnabled: boolean;
  domains: Array<Domain>;
}): ProjectSSO => {
  const row: ProjectSSO = new ProjectSSO();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.isEnabled = data.isEnabled;
  row.domains = data.domains;
  return row;
};

const oidc: (data: {
  name: string;
  isEnabled: boolean;
  domains: Array<Domain>;
}) => ProjectOIDC = (data: {
  name: string;
  isEnabled: boolean;
  domains: Array<Domain>;
}): ProjectOIDC => {
  const row: ProjectOIDC = new ProjectOIDC();
  row._id = ObjectID.generate().toString();
  row.name = data.name;
  row.isEnabled = data.isEnabled;
  row.domains = data.domains;
  return row;
};

// What the notice's reads answer.
let samlRows: Array<ProjectSSO>;
let oidcRows: Array<ProjectOIDC>;
let verifiedDomainRows: Array<Domain>;
let readsFail: boolean;
let getListSpy: SpyInstance<typeof ModelAPI.getList>;
let navigateSpy: SpyInstance<typeof Navigation.navigate>;

// The arguments of every read the notice made, by the model read.
const readsOf: (tableName: string) => Array<Record<string, unknown>> = (
  tableName: string,
): Array<Record<string, unknown>> => {
  return getListSpy.mock.calls
    .map((call: Array<unknown>): Record<string, unknown> => {
      return call[0] as Record<string, unknown>;
    })
    .filter((options: Record<string, unknown>): boolean => {
      const modelType: { new (): { tableName?: string | undefined } } = options[
        "modelType"
      ] as { new (): { tableName?: string | undefined } };

      return new modelType().tableName === tableName;
    });
};

const renderNotice: (props: {
  hasProviders: boolean;
  refreshToken: number;
}) => ReturnType<typeof render> = (props: {
  hasProviders: boolean;
  refreshToken: number;
}): ReturnType<typeof render> => {
  return render(
    <SsoProvidersNotOfferedNotice
      projectId={PROJECT_ID}
      hasProviders={props.hasProviders}
      refreshToken={props.refreshToken}
    />,
  );
};

// Waits out the notice's delay and its reads.
const settleReads: (reads?: number) => Promise<void> = async (
  reads: number = 1,
): Promise<void> => {
  await waitFor(
    () => {
      expect(getListSpy).toHaveBeenCalledTimes(3 * reads);
    },
    { timeout: SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS * 8 },
  );

  // A turn of the event loop: every answer, and what it sets, has landed.
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const noticeText: () => string = (): string => {
  return screen.getByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID)
    .textContent as string;
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: english },
      de: { translation: german },
      fa: { translation: persian },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("en");

  samlRows = [];
  oidcRows = [];
  verifiedDomainRows = [domain("acme.com", true)];
  readsFail = false;

  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {
    return undefined;
  });
  getListSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: Parameters<typeof ModelAPI.getList>[0]) => {
        if (readsFail) {
          throw new Error("network down");
        }

        const tableName: string | undefined = new options.modelType().tableName;
        const data: Array<unknown> =
          tableName === "ProjectSSO"
            ? samlRows
            : tableName === "ProjectOIDC"
              ? oidcRows
              : verifiedDomainRows;

        return {
          data: data,
          count: data.length,
          skip: 0,
          limit: 100,
        } as never;
      },
    ) as unknown as SpyInstance<typeof ModelAPI.getList>;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("whether Sign in with SSO finds a provider by email", () => {
  test("a provider that is on and lists a verified domain is found", () => {
    expect(
      isFoundByEmail({
        name: "Okta",
        isEnabled: true,
        domains: [domain("acme.com", true)],
      }),
    ).toBe(true);
  });

  test("one that lists only domains not verified, or none, is found by nobody", () => {
    for (const domains of [[], [domain("acme.dev", false)], undefined]) {
      expect(
        isFoundByEmail({ name: "Okta", isEnabled: true, domains: domains }),
      ).toBe(false);
    }
  });

  test("one that is off is found by nobody, but the notice does not name it: it is offered nowhere, and its Enabled column says so", () => {
    const off: SsoProviderDomainsRow = {
      name: "Old Okta",
      isEnabled: false,
      domains: [],
    };

    expect(isFoundByEmail(off)).toBe(false);
    expect(getProvidersNotFoundByEmail([off])).toEqual([]);
  });

  test("the notice names those that are on and found by nobody, in the order they came", () => {
    const providers: Array<SsoProviderDomainsRow> = [
      { name: "Okta", isEnabled: true, domains: [domain("acme.com", true)] },
      { name: "Entra ID", isEnabled: true, domains: [] },
      { name: "Old", isEnabled: false, domains: [] },
      { name: "Google", isEnabled: true, domains: [domain("acme.dev", false)] },
    ];

    expect(getProvidersNotFoundByEmail(providers).map(getProviderName)).toEqual(
      ["Entra ID", "Google"],
    );
  });

  test("a provider's verified domains are the ones it is found by", () => {
    expect(
      getVerifiedDomains({
        domains: [domain("acme.com", true), domain("acme.dev", false)],
      }).map((row: Domain): string => {
        return row.domain?.toString() || "";
      }),
    ).toEqual(["acme.com"]);
    expect(getProviderName({ name: "  Okta  " })).toBe("Okta");
  });

  test("the reads ask for each provider's domains and whether they are verified", () => {
    expect(SSO_PROVIDER_DOMAINS_SELECT).toEqual({
      _id: true,
      name: true,
      isEnabled: true,
      domains: { _id: true, domain: true, isVerified: true },
    });
  });
});

describe("a provider's Domains column", () => {
  test("draws each verified domain as written", () => {
    render(
      <SsoProviderDomainsElement
        domains={[domain("acme.com", true), domain("acme.io", true)]}
      />,
    );

    const cell: HTMLElement = screen.getByTestId(SSO_PROVIDER_DOMAINS_TEST_ID);

    expect(within(cell).getByText("acme.com")).toBeInTheDocument();
    expect(within(cell).getByText("acme.io")).toBeInTheDocument();
    expect(
      within(cell).queryByText(english["No verified domain"]!),
    ).not.toBeInTheDocument();
  });

  test("says a domain it lists is not verified, and that it has no verified domain", () => {
    render(<SsoProviderDomainsElement domains={[domain("acme.dev", false)]} />);

    const cell: HTMLElement = screen.getByTestId(SSO_PROVIDER_DOMAINS_TEST_ID);

    expect(cell).toHaveTextContent("acme.dev (not verified)");
    expect(cell).toHaveTextContent("No verified domain");
  });

  test("with no domain at all, says it has no verified domain", () => {
    render(<SsoProviderDomainsElement domains={[]} />);

    expect(screen.getByTestId(SSO_PROVIDER_DOMAINS_TEST_ID)).toHaveTextContent(
      "No verified domain",
    );
  });

  test("reads in the reader's language, the domain as written", async () => {
    await i18next.changeLanguage("de");

    render(<SsoProviderDomainsElement domains={[domain("acme.dev", false)]} />);

    const cell: HTMLElement = screen.getByTestId(SSO_PROVIDER_DOMAINS_TEST_ID);

    expect(cell).toHaveTextContent(german["No verified domain"]!);
    expect(cell).toHaveTextContent("acme.dev (nicht verifiziert)");
  });
});

describe("the notice over the provider cards", () => {
  test("reads nothing, and says nothing, while the project has no provider", async () => {
    renderNotice({ hasProviders: false, refreshToken: 3 });

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS * 2);
      });
    });

    expect(getListSpy).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("reads every provider of both kinds with its domains, and whether the project has a verified domain, of this project", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    for (const tableName of ["ProjectSSO", "ProjectOIDC"]) {
      const [options] = readsOf(tableName);

      expect(options?.["query"]).toEqual({ projectId: PROJECT_ID });
      expect(options?.["select"]).toEqual(SSO_PROVIDER_DOMAINS_SELECT);
      expect(options?.["limit"]).toBeGreaterThanOrEqual(100);
    }

    const [domains] = readsOf("Domain");

    expect(domains?.["query"]).toEqual({
      projectId: PROJECT_ID,
      isVerified: true,
    });
    expect(domains?.["limit"]).toBe(1);
  });

  test("says nothing while every provider that is on is found by some address's domain", async () => {
    samlRows = [
      saml({
        name: "Okta",
        isEnabled: true,
        domains: [domain("acme.com", true)],
      }),
      saml({ name: "Old Okta", isEnabled: false, domains: [] }),
    ];
    oidcRows = [
      oidc({
        name: "Entra ID",
        isEnabled: true,
        domains: [domain("acme.com", true), domain("acme.dev", false)],
      }),
    ];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(
      screen.queryByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("names one provider that is found by nobody's email, and says to pick a domain under Domains", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(noticeText()).toBe(
      "People cannot find this provider by their email on Sign in with SSO, because it lists no verified domain: Okta. Edit it and pick one under Domains.",
    );
    // There is a verified domain to pick: nothing to verify first.
    expect(
      screen.queryByRole("button", { name: /Verify a Domain/ }),
    ).not.toBeInTheDocument();
  });

  test("names several, of both kinds, leaving out the ones that are off or found", async () => {
    samlRows = [
      saml({ name: "Okta", isEnabled: true, domains: [] }),
      saml({ name: "Old Okta", isEnabled: false, domains: [] }),
      saml({
        name: "Okta EU",
        isEnabled: true,
        domains: [domain("acme.eu", true)],
      }),
    ];
    oidcRows = [
      oidc({
        name: "Entra ID",
        isEnabled: true,
        domains: [domain("acme.dev", false)],
      }),
    ];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(noticeText()).toBe(
      "People cannot find these providers by their email on Sign in with SSO, because they list no verified domain: Okta, Entra ID. Edit each one and pick a domain under Domains.",
    );
  });

  test("while the project has no verified domain, says to verify one first, and Verify a Domain opens Project Settings > Domains", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];
    verifiedDomainRows = [];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(noticeText()).toContain(
      "People cannot find this provider by their email on Sign in with SSO until your project verifies a domain: Okta. Verify one, then pick it under the provider's Domains.",
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Verify a Domain/ }));
    });

    expect(
      navigateSpy.mock.calls.map(
        (call: Parameters<typeof Navigation.navigate>): string => {
          return call[0].toString();
        },
      ),
    ).toEqual([`/dashboard/${PROJECT_ID.toString()}/settings/domains`]);
  });

  test("the several of them, while the project has no verified domain", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];
    oidcRows = [oidc({ name: "Entra ID", isEnabled: true, domains: [] })];
    verifiedDomainRows = [];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(noticeText()).toContain(
      "People cannot find these providers by their email on Sign in with SSO until your project verifies a domain: Okta, Entra ID. Verify one, then pick it under each provider's Domains.",
    );
  });

  test("reads once for a burst of table loads - both tables load as the page opens", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];

    const view: ReturnType<typeof render> = renderNotice({
      hasProviders: true,
      refreshToken: 1,
    });

    view.rerender(
      <SsoProvidersNotOfferedNotice
        projectId={PROJECT_ID}
        hasProviders={true}
        refreshToken={2}
      />,
    );
    view.rerender(
      <SsoProvidersNotOfferedNotice
        projectId={PROJECT_ID}
        hasProviders={true}
        refreshToken={3}
      />,
    );

    await settleReads();

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, SSO_PROVIDERS_NOTICE_READ_DELAY_IN_MS * 2);
      });
    });

    expect(getListSpy).toHaveBeenCalledTimes(3);
  });

  test("reads again when a table reloads: a provider given a domain leaves the notice", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];

    const view: ReturnType<typeof render> = renderNotice({
      hasProviders: true,
      refreshToken: 1,
    });

    await settleReads();

    expect(
      screen.getByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).toBeInTheDocument();

    // Its admin picked a domain, and the table loaded again.
    samlRows = [
      saml({
        name: "Okta",
        isEnabled: true,
        domains: [domain("acme.com", true)],
      }),
    ];

    view.rerender(
      <SsoProvidersNotOfferedNotice
        projectId={PROJECT_ID}
        hasProviders={true}
        refreshToken={2}
      />,
    );

    await settleReads(2);

    expect(
      screen.queryByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("goes when the last provider does", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];

    const view: ReturnType<typeof render> = renderNotice({
      hasProviders: true,
      refreshToken: 1,
    });

    await settleReads();

    expect(
      screen.getByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).toBeInTheDocument();

    view.rerender(
      <SsoProvidersNotOfferedNotice
        projectId={PROJECT_ID}
        hasProviders={false}
        refreshToken={2}
      />,
    );

    expect(
      screen.queryByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a read that fails says nothing: the rows' Domains column still does", async () => {
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];
    readsFail = true;

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(
      screen.queryByTestId(SSO_PROVIDERS_NOT_OFFERED_NOTICE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("German reads German, the names as written", async () => {
    await i18next.changeLanguage("de");
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];
    verifiedDomainRows = [];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    const germanSentence: string = german[
      `${ProjectSsoCopy.notOfferedUntilVerifiedNotice.other}_one`
    ]!.replace("{{names}}", "Okta");

    expect(noticeText()).toContain(germanSentence);
    expect(
      screen.getByRole("button", {
        name: new RegExp(german[ProjectSsoCopy.verifyDomainAction]!),
      }),
    ).toBeInTheDocument();
  });

  test("Persian lists the names with its own separator", async () => {
    await i18next.changeLanguage("fa");
    samlRows = [saml({ name: "Okta", isEnabled: true, domains: [] })];
    oidcRows = [oidc({ name: "Entra ID", isEnabled: true, domains: [] })];

    renderNotice({ hasProviders: true, refreshToken: 1 });

    await settleReads();

    expect(noticeText()).toContain("Okta، Entra ID");
    expect(noticeText()).not.toContain("People cannot find");
  });

  test("every Dashboard language words both notices, in their one and other forms, with the names in each", () => {
    for (const code of [
      "de",
      "fr",
      "es",
      "it",
      "pt",
      "nl",
      "da",
      "no",
      "sv",
      "ru",
      "ja",
      "ko",
      "zh-CN",
      "zh-TW",
      "hi",
      "fa",
      "ar",
    ]) {
      const locale: Record<string, string> = readLocale(code);

      for (const template of [
        ProjectSsoCopy.notOfferedNotice,
        ProjectSsoCopy.notOfferedUntilVerifiedNotice,
      ]) {
        for (const key of [template.other, `${template.other}_one`]) {
          const words: string | undefined = locale[key];

          expect({ code, key, names: words?.includes("{{names}}") }).toEqual({
            code,
            key,
            names: true,
          });
          expect({ code, key, english: words === english[key] }).toEqual({
            code,
            key,
            english: false,
          });
        }
      }

      for (const key of [
        ProjectSsoCopy.noVerifiedDomain,
        ProjectSsoCopy.domainNotVerified,
        ProjectSsoCopy.signInLinkTitle,
        ProjectSsoCopy.signInLinkSentence,
        ProjectSsoCopy.verifyDomainAction,
      ]) {
        expect({ code, key, translated: locale[key] !== english[key] }).toEqual(
          { code, key, translated: true },
        );
      }

      expect(locale[ProjectSsoCopy.domainNotVerified]).toContain("{{domain}}");
    }
  });
});

describe("the SSO Sign-in Link card", () => {
  const LINK: string = `https://oneuptime.example.com/accounts/sso/${PROJECT_ID.toString()}`;

  const renderCard: () => void = (): void => {
    render(<ProjectSsoSignInLinkCard projectId={PROJECT_ID} />);
  };

  test("prints the project's SSO sign-in link, on the Accounts app, byte for byte", () => {
    expect(getProjectSsoSignInLink(PROJECT_ID)).toBe(LINK);

    renderCard();

    const card: HTMLElement = screen.getByTestId(
      PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID,
    );
    const link: HTMLElement = within(card).getByText(LINK, { exact: true });

    expect(link.closest("a")).toHaveAttribute("href", LINK);
    expect(link.closest("a")).toHaveAttribute("target", "_blank");
  });

  test("says what the link is for: sharing it, whatever a person's email domain, and trying it first", () => {
    renderCard();

    expect(screen.getByText("SSO Sign-in Link")).toBeInTheDocument();
    expect(
      screen.getByTestId(PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID),
    ).toHaveTextContent(
      "Share this link so people can sign in with these providers, whatever their email's domain. Try it before you require SSO.",
    );
  });

  test("copies the link as printed", async () => {
    const copied: Array<string> = [];

    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string): Promise<void> => {
          copied.push(text);
        },
      },
    });

    renderCard();

    await act(async () => {
      fireEvent.click(
        within(
          screen.getByTestId(PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID),
        ).getByRole("button"),
      );
    });

    expect(copied).toEqual([LINK]);
  });

  test("reads in the reader's language, the link as printed", async () => {
    await i18next.changeLanguage("de");

    renderCard();

    expect(
      screen.getByText(german[ProjectSsoCopy.signInLinkTitle]!),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(PROJECT_SSO_SIGN_IN_LINK_CARD_TEST_ID),
    ).toHaveTextContent(german[ProjectSsoCopy.signInLinkSentence]!);
    expect(screen.getByText(LINK, { exact: true })).toBeInTheDocument();
  });

  test("the card's element is a function component", () => {
    const element: ReactElement = (
      <ProjectSsoSignInLinkCard projectId={PROJECT_ID} />
    );

    expect(typeof element.type).toBe("function");
  });
});
