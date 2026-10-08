import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What an email knows about how the installation names and shows itself
 * (Utils/EmailBranding.ts): the variables MailService.render adds to every
 * email, and the subject's own words.
 *
 * Without branding, an email gets brandProductName "OneUptime" and nothing
 * else, so every template and partial renders exactly as it did before (see
 * EmailBrandingTemplates.test.ts). The host is pinned here, so the logo's
 * absolute address is predictable.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    Host: "status.acme.example",
    HttpProtocol: "https://",
  };
});

import EnterpriseEdition from "Common/Server/Enterprise/EnterpriseEdition";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Dictionary from "Common/Types/Dictionary";
import {
  BRAND_VARIABLE_NAMES,
  getCurrentEmailBrandingVariables,
  getEmailBrandingVariables,
  toAbsoluteUrl,
  withBrandedSubject,
} from "../../FeatureSet/Notification/Utils/EmailBranding";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("getEmailBrandingVariables", () => {
  test.each([
    ["no branding", null],
    ["an empty branding", {}],
    ["the name OneUptime", { productName: "OneUptime" }],
  ])(
    "%s: OneUptime, and nothing else that changes an email",
    (_label: string, branding: ProductBranding | null) => {
      expect(getEmailBrandingVariables(branding)).toEqual({
        brandProductName: "OneUptime",
      });
    },
  );

  test("a name of its own: renamed", () => {
    expect(getEmailBrandingVariables({ productName: "Acme & Co" })).toEqual({
      brandProductName: "Acme & Co",
      isBrandRenamed: "true",
    });
  });

  test("a renamed installation's website is where 'Powered by' links", () => {
    expect(
      getEmailBrandingVariables({
        productName: "Acme",
        websiteUrl: "https://acme.example",
      }),
    ).toEqual({
      brandProductName: "Acme",
      isBrandRenamed: "true",
      brandWebsiteUrl: "https://acme.example",
    });
  });

  test("a website without a name of its own changes nothing: Powered by OneUptime links to oneuptime.com", () => {
    expect(
      getEmailBrandingVariables({ websiteUrl: "https://acme.example" }),
    ).toEqual({ brandProductName: "OneUptime" });
  });

  test("a logo a mail client can draw goes in as an absolute address on this host", () => {
    expect(
      getEmailBrandingVariables({
        productName: "Acme",
        logoUrl: "/api/branding/logo?v=1700000000000",
        isLogoEmailSafe: true,
      }),
    ).toEqual({
      brandProductName: "Acme",
      isBrandRenamed: "true",
      brandLogoUrl:
        "https://status.acme.example/api/branding/logo?v=1700000000000",
    });
  });

  test("a logo without a name of its own still goes in", () => {
    expect(
      getEmailBrandingVariables({
        logoUrl: "/api/branding/logo?v=1",
        isLogoEmailSafe: true,
      })["brandLogoUrl"],
    ).toBe("https://status.acme.example/api/branding/logo?v=1");
  });

  test("an SVG or WebP logo (not email safe) stays out: the email shows the name", () => {
    expect(
      getEmailBrandingVariables({
        productName: "Acme",
        logoUrl: "/api/branding/logo?v=1",
      }),
    ).toEqual({ brandProductName: "Acme", isBrandRenamed: "true" });
  });

  test("names exactly the variables MailService reserves", () => {
    const variables: Dictionary<string> = getEmailBrandingVariables({
      productName: "Acme",
      websiteUrl: "https://acme.example",
      logoUrl: "/api/branding/logo?v=1",
      isLogoEmailSafe: true,
    });

    expect(Object.keys(variables).sort()).toEqual(
      [...BRAND_VARIABLE_NAMES].sort(),
    );
  });
});

describe("toAbsoluteUrl", () => {
  test("puts the path on this installation's host", () => {
    expect(toAbsoluteUrl("/api/branding/logo?v=2")).toBe(
      "https://status.acme.example/api/branding/logo?v=2",
    );
  });
});

describe("getCurrentEmailBrandingVariables", () => {
  test("reads the branding the enterprise module hands core", () => {
    jest
      .spyOn(EnterpriseEdition, "getProductBranding")
      .mockReturnValue({ productName: "Acme" });

    expect(getCurrentEmailBrandingVariables()).toEqual({
      brandProductName: "Acme",
      isBrandRenamed: "true",
    });
  });

  test("is OneUptime on an installation without the enterprise module", () => {
    expect(getCurrentEmailBrandingVariables()).toEqual({
      brandProductName: "OneUptime",
    });
  });
});

describe("withBrandedSubject", () => {
  const RENAMED: Dictionary<string> = {
    brandProductName: "Acme",
    isBrandRenamed: "true",
  };

  test("leaves a subject alone on an installation that is not renamed", () => {
    const subject: string = "Welcome to OneUptime, {{name}}";

    expect(withBrandedSubject(subject, { brandProductName: "OneUptime" })).toBe(
      subject,
    );
  });

  test("puts a reference to the name in place of OneUptime's own", () => {
    expect(withBrandedSubject("Welcome to OneUptime, {{name}}", RENAMED)).toBe(
      "Welcome to {{{brandProductName}}}, {{name}}",
    );
  });

  test("never the name itself, so nothing in it is read as template syntax", () => {
    expect(
      withBrandedSubject("Sign in to OneUptime", {
        brandProductName: "{{secret}}",
        isBrandRenamed: "true",
      }),
    ).toBe("Sign in to {{{brandProductName}}}");
  });

  test("leaves addresses and identifiers in the subject alone", () => {
    expect(
      withBrandedSubject(
        "OneUptime: see https://oneuptime.com and OneUptimeReplay",
        RENAMED,
      ),
    ).toBe(
      "{{{brandProductName}}}: see https://oneuptime.com and OneUptimeReplay",
    );
  });
});

describe("without a host", () => {
  // The mocked EnvironmentConfig above: EmailBranding reads Host when it runs.
  const environment: { Host: string } = jest.requireMock(
    "Common/Server/EnvironmentConfig",
  );

  afterEach(() => {
    environment.Host = "status.acme.example";
  });

  test.each(["", "   "])(
    "an email shows the name in place of a logo it could not address (HOST %j)",
    (host: string) => {
      environment.Host = host;

      expect(toAbsoluteUrl("/api/branding/logo?v=1")).toBeNull();
      expect(
        getEmailBrandingVariables({
          productName: "Acme",
          logoUrl: "/api/branding/logo?v=1",
          isLogoEmailSafe: true,
        }),
      ).toEqual({ brandProductName: "Acme", isBrandRenamed: "true" });
    },
  );
});
