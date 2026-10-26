import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What an email knows about how the installation names and shows itself
 * (Utils/EmailBranding.ts): the variables MailService.render adds to every
 * email, and the subject's own words.
 *
 * Without branding, an email gets brandProductName "OneUptime" and
 * OneUptime's own logo as the image itself (oneUptimeLogoUrl, a data: URL
 * that goes out inside the email - EmailLogo, issue #5124), and nothing
 * else (see EmailBrandingTemplates.test.ts). The host is pinned here, so a
 * logo of the installation's own has a predictable absolute address.
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
import EmailLogo from "Common/Server/Utils/Mail/EmailLogo";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import Dictionary from "Common/Types/Dictionary";
import {
  BRAND_VARIABLE_NAMES,
  ONEUPTIME_LOGO_VARIABLE_NAME,
  getCurrentEmailBrandingVariables,
  getEmailBrandingVariables,
  toAbsoluteUrl,
  withBrandedSubject,
} from "../../FeatureSet/Notification/Utils/EmailBranding";

afterEach(() => {
  jest.restoreAllMocks();
});

// OneUptime's logo, as the email carries it.
const ONEUPTIME_LOGO: string = EmailLogo.getDataUrl() as string;

describe("getEmailBrandingVariables", () => {
  test("OneUptime's logo is the image itself, never an address", () => {
    expect(ONEUPTIME_LOGO.startsWith("data:image/png;base64,")).toBe(true);

    const parsed: globalThis.URL = new globalThis.URL(ONEUPTIME_LOGO);

    expect([parsed.protocol, parsed.host]).toEqual(["data:", ""]);
  });

  test.each([
    ["no branding", null],
    ["an empty branding", {}],
    ["the name OneUptime", { productName: "OneUptime" }],
  ])(
    "%s: OneUptime, with its logo inside the email, and nothing else",
    (_label: string, branding: ProductBranding | null) => {
      expect(getEmailBrandingVariables(branding)).toEqual({
        brandProductName: "OneUptime",
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
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
    ).toEqual({
      brandProductName: "OneUptime",
      oneUptimeLogoUrl: ONEUPTIME_LOGO,
    });
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

  test("a logo without a name of its own still goes in, in place of OneUptime's", () => {
    expect(
      getEmailBrandingVariables({
        logoUrl: "/api/branding/logo?v=1",
        isLogoEmailSafe: true,
      }),
    ).toEqual({
      brandProductName: "OneUptime",
      brandLogoUrl: "https://status.acme.example/api/branding/logo?v=1",
    });
  });

  test("an SVG or WebP logo (not email safe) stays out: the email shows the name", () => {
    expect(
      getEmailBrandingVariables({
        productName: "Acme",
        logoUrl: "/api/branding/logo?v=1",
      }),
    ).toEqual({ brandProductName: "Acme", isBrandRenamed: "true" });
  });

  test("an SVG or WebP logo without a name of its own: OneUptime's, inside the email", () => {
    expect(
      getEmailBrandingVariables({
        logoUrl: "/api/branding/logo?v=1",
        isLogoEmailSafe: false,
      }),
    ).toEqual({
      brandProductName: "OneUptime",
      oneUptimeLogoUrl: ONEUPTIME_LOGO,
    });
  });

  test("a renamed installation never carries OneUptime's logo", () => {
    for (const branding of [
      { productName: "Acme" },
      { productName: "Acme", websiteUrl: "https://acme.example" },
      { productName: "Acme", logoUrl: "/api/branding/logo?v=1" },
      {
        productName: "Acme",
        logoUrl: "/api/branding/logo?v=1",
        isLogoEmailSafe: true,
      },
    ] as Array<ProductBranding>) {
      expect(Object.keys(getEmailBrandingVariables(branding))).not.toContain(
        "oneUptimeLogoUrl",
      );
    }
  });

  test("a logo whose file cannot be read leaves the name alone, never a broken image", () => {
    jest.spyOn(EmailLogo, "getDataUrl").mockReturnValue(null);

    expect(getEmailBrandingVariables(null)).toEqual({
      brandProductName: "OneUptime",
    });
  });

  test("names exactly the variables MailService reserves", () => {
    const named: Set<string> = new Set<string>();

    for (const branding of [
      null,
      {
        productName: "Acme",
        websiteUrl: "https://acme.example",
        logoUrl: "/api/branding/logo?v=1",
        isLogoEmailSafe: true,
      },
    ] as Array<ProductBranding | null>) {
      for (const name of Object.keys(getEmailBrandingVariables(branding))) {
        named.add(name);
      }
    }

    expect([...named].sort()).toEqual([...BRAND_VARIABLE_NAMES].sort());
  });

  /*
   * An email a mail service would not take with its images is rendered
   * again without this variable (MailService.sendEvenWithoutImages), so its
   * header shows the name alone: it must be the one that carries the logo.
   */
  test("the logo's variable is the one OneUptime's logo is carried in", () => {
    expect(BRAND_VARIABLE_NAMES).toContain(ONEUPTIME_LOGO_VARIABLE_NAME);
    expect(getEmailBrandingVariables(null)[ONEUPTIME_LOGO_VARIABLE_NAME]).toBe(
      ONEUPTIME_LOGO,
    );
    expect(
      Object.keys(getEmailBrandingVariables(null)).filter((name: string) => {
        return getEmailBrandingVariables(null)[name] === ONEUPTIME_LOGO;
      }),
    ).toEqual([ONEUPTIME_LOGO_VARIABLE_NAME]);
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

  test("is OneUptime, with its logo inside the email, on an installation without the enterprise module", () => {
    expect(getCurrentEmailBrandingVariables()).toEqual({
      brandProductName: "OneUptime",
      oneUptimeLogoUrl: ONEUPTIME_LOGO,
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
  ) as { Host: string };

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

  test.each(["", "   "])(
    "OneUptime's logo needs no host: it is inside the email (HOST %j)",
    (host: string) => {
      environment.Host = host;

      expect(getEmailBrandingVariables(null)).toEqual({
        brandProductName: "OneUptime",
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
      });
      // A logo of its own it cannot address, and OneUptime's name: OneUptime's logo.
      expect(
        getEmailBrandingVariables({
          logoUrl: "/api/branding/logo?v=1",
          isLogoEmailSafe: true,
        }),
      ).toEqual({
        brandProductName: "OneUptime",
        oneUptimeLogoUrl: ONEUPTIME_LOGO,
      });
    },
  );
});
