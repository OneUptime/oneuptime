import { describe, expect, test } from "@jest/globals";
import ProductBrandingUtil, {
  ONEUPTIME_PRODUCT_NAME,
  PRODUCT_BRANDING_ENVIRONMENT_KEY,
  PRODUCT_NAME_MAX_LENGTH,
  ProductBranding,
} from "../../../Types/Branding/ProductBranding";

/*
 * How the installation names and shows itself: OneUptime unless the
 * enterprise module says otherwise. Pinned here: what counts as a name of its
 * own, how OneUptime's name is replaced in the product's sentences (as a word
 * only - never inside commands, URLs, identifiers or environment variables),
 * which names and addresses are accepted at all, and the round trip through
 * env.js.
 */

describe("the defaults", () => {
  test("the product is OneUptime, and env.js carries the branding as PRODUCT_BRANDING", () => {
    expect(ONEUPTIME_PRODUCT_NAME).toBe("OneUptime");
    expect(PRODUCT_BRANDING_ENVIRONMENT_KEY).toBe("PRODUCT_BRANDING");
    expect(PRODUCT_NAME_MAX_LENGTH).toBe(50);
  });

  test.each([
    ["no branding", null],
    ["undefined", undefined],
    ["an empty branding", {}],
    ["a blank name", { productName: "   " }],
    ["the name OneUptime", { productName: "OneUptime" }],
    ["a logo alone", { logoUrl: "/api/branding/logo" }],
  ])(
    "%s is OneUptime, not renamed",
    (_label: string, branding: ProductBranding | null | undefined) => {
      expect(ProductBrandingUtil.getProductName(branding)).toBe("OneUptime");
      expect(ProductBrandingUtil.isRenamed(branding)).toBe(false);
    },
  );

  test("a name of its own is the product's name, trimmed", () => {
    expect(
      ProductBrandingUtil.getProductName({ productName: "  Acme Monitoring " }),
    ).toBe("Acme Monitoring");
    expect(ProductBrandingUtil.isRenamed({ productName: "Acme" })).toBe(true);
  });
});

describe("replaceProductName", () => {
  const replace: (text: string) => string = (text: string): string => {
    return ProductBrandingUtil.replaceProductName(text, "Acme");
  };

  test.each([
    ["Sign in to OneUptime", "Sign in to Acme"],
    ["OneUptime AI found a cause.", "Acme AI found a cause."],
    ["Welcome to OneUptime!", "Welcome to Acme!"],
    ["OneUptime's caching", "Acme's caching"],
    ["(OneUptime)", "(Acme)"],
    ["OneUptime, OneUptime and OneUptime.", "Acme, Acme and Acme."],
    ["«OneUptime»", "«Acme»"],
    ["Bereitgestellt von OneUptime", "Bereitgestellt von Acme"],
    ["由 OneUptime 提供", "由 Acme 提供"],
    ["OneUptime", "Acme"],
    ["Line one\nOneUptime on line two", "Line one\nAcme on line two"],
    ["Erstellen Sie Ihr OneUptime-Konto", "Erstellen Sie Ihr Acme-Konto"],
    ["a OneUptime-powered page", "a Acme-powered page"],
    ["Ge OneUptimes support åtkomst", "Ge Acmes support åtkomst"],
    ["läret visar OneUptimes logotyp.", "läret visar Acmes logotyp."],
  ])("replaces the word in %j", (text: string, expected: string) => {
    expect(replace(text)).toBe(expected);
  });

  test.each([
    ["an identifier", "Call OneUptimeReplay.identify()"],
    ["a header name", "the X-OneUptime-Signature header"],
    ["a GitHub path", "https://github.com/OneUptime/oneuptime"],
    ["a domain", "Visit OneUptime.com"],
    ["a command", "run oneuptime login"],
    ["an environment variable", "set ONEUPTIME_URL"],
    ["a lower-case URL", "https://oneuptime.com/docs"],
    ["an email address", "support@OneUptime.com"],
    ["a word joined in front of it", "Smart-OneUptime"],
    ["a file name", "OneUptime.png"],
    ["a snake_case name", "my_OneUptime_probe"],
    ["a chat app's handle", "type @OneUptime in the message box"],
    ["a longer word starting with it", "OneUptimesque"],
  ])("leaves %s alone", (_label: string, text: string) => {
    expect(replace(text)).toBe(text);
  });

  test("inserts a name with $ patterns as it is, never as a replacement pattern", () => {
    expect(
      ProductBrandingUtil.replaceProductName("Sign in to OneUptime", "$& $1 $$"),
    ).toBe("Sign in to $& $1 $$");
  });

  test("a name that contains OneUptime is not replaced again", () => {
    expect(
      ProductBrandingUtil.replaceProductName(
        "Sign in to OneUptime",
        "OneUptime by Acme",
      ),
    ).toBe("Sign in to OneUptime by Acme");
  });

  test("leaves text alone when there is no name to put in", () => {
    expect(ProductBrandingUtil.replaceProductName("OneUptime", "")).toBe(
      "OneUptime",
    );
    expect(ProductBrandingUtil.replaceProductName("OneUptime", "  ")).toBe(
      "OneUptime",
    );
  });

  test("does not touch text that does not name the product", () => {
    const text: string = "Nothing to see here";

    expect(ProductBrandingUtil.replaceProductName(text, "Acme")).toBe(text);
  });

  test("handles a long text in time linear in its length", () => {
    const text: string = "OneUptime ".repeat(200000);
    const startedAt: number = Date.now();

    const replaced: string = ProductBrandingUtil.replaceProductName(
      text,
      "Acme",
    );

    expect(replaced).toBe("Acme ".repeat(200000));
    expect(Date.now() - startedAt).toBeLessThan(5000);
  });
});

describe("getProductNameProblem", () => {
  test.each(["Acme", "Acme & Co", "L'Observatoire", "監視", "A".repeat(50)])(
    "takes %j",
    (name: string) => {
      expect(ProductBrandingUtil.getProductNameProblem(name)).toBeNull();
    },
  );

  test("refuses a name longer than 50 characters", () => {
    expect(ProductBrandingUtil.getProductNameProblem("A".repeat(51))).toBe(
      "The product name can be at most 50 characters.",
    );
  });

  test.each([
    "Acme\nCloud",
    "Acme\rCloud",
    "Acme\tCloud",
    "Acme\u0000",
    "Acme\u007f",
    "Acme\u0085",
    "Acme <b>",
    "Acme >",
    "{{x}}",
    "Acme }",
  ])("refuses %j", (name: string) => {
    expect(ProductBrandingUtil.getProductNameProblem(name)).toBe(
      "The product name can't contain line breaks or the characters < > { }.",
    );
  });
});

describe("addresses", () => {
  test.each([
    ["/api/branding/logo?v=1", true],
    ["/x", true],
    ["//evil.example/logo.png", false],
    ["https://evil.example/logo.png", false],
    ["javascript:alert(1)", false],
    ["/api/branding/logo with space", false],
    ["/api\\branding", false],
    ["", false],
    [42, false],
  ])("isSameHostPath(%j) is %s", (value: unknown, expected: boolean) => {
    expect(ProductBrandingUtil.isSameHostPath(value)).toBe(expected);
  });

  test.each([
    ["https://acme.example", true],
    ["http://acme.example/path?x=1", true],
    ["  https://acme.example  ", true],
    ["ftp://acme.example", false],
    ["javascript:alert(1)", false],
    ["//acme.example", false],
    ["acme.example", false],
    ["https://", false],
    [null, false],
  ])("isWebsiteUrl(%j) is %s", (value: unknown, expected: boolean) => {
    expect(ProductBrandingUtil.isWebsiteUrl(value)).toBe(expected);
  });
});

describe("sanitize", () => {
  test("keeps every usable field", () => {
    const branding: ProductBranding = {
      productName: "Acme",
      websiteUrl: "https://acme.example",
      logoUrl: "/api/branding/logo?v=1",
      darkLogoUrl: "/api/branding/dark-logo?v=1",
      faviconUrl: "/api/branding/favicon?v=1",
      isLogoEmailSafe: true,
    };

    expect(ProductBrandingUtil.sanitize(branding)).toEqual(branding);
  });

  test("drops whatever cannot be used, and any field it does not know", () => {
    expect(
      ProductBrandingUtil.sanitize({
        productName: "Acme <script>",
        websiteUrl: "javascript:alert(1)",
        logoUrl: "https://evil.example/logo.png",
        darkLogoUrl: "//evil.example",
        faviconUrl: 7,
        isLogoEmailSafe: "yes",
        somethingElse: "x",
      }),
    ).toEqual({});
  });

  test("says a logo is email safe only when there is a logo", () => {
    expect(
      ProductBrandingUtil.sanitize({ isLogoEmailSafe: true }),
    ).toEqual({});
  });

  test.each([null, undefined, "x", 1, []])(
    "is {} for %j",
    (value: unknown) => {
      expect(ProductBrandingUtil.sanitize(value)).toEqual({});
    },
  );
});

describe("the env.js value", () => {
  test("round-trips", () => {
    const branding: ProductBranding = {
      productName: 'Acme "Cloud" & Co',
      faviconUrl: "/api/branding/favicon?v=2",
    };

    expect(
      ProductBrandingUtil.fromEnvironmentValue(
        ProductBrandingUtil.toEnvironmentValue(branding),
      ),
    ).toEqual(branding);
  });

  test("{} means: may differ, nothing set", () => {
    expect(ProductBrandingUtil.fromEnvironmentValue("{}")).toEqual({});
  });

  test.each([
    ["absent", undefined],
    ["empty", ""],
    ["not JSON", "{"],
    ["a list", "[]"],
    ["a string", '"Acme"'],
    ["null", "null"],
    ["a number", 5],
  ])("%s is no branding at all (null)", (_label: string, value: unknown) => {
    expect(ProductBrandingUtil.fromEnvironmentValue(value)).toBeNull();
  });

  test("never carries an unusable field into the page", () => {
    expect(
      ProductBrandingUtil.fromEnvironmentValue(
        JSON.stringify({
          productName: "Acme",
          logoUrl: "javascript:alert(1)",
        }),
      ),
    ).toEqual({ productName: "Acme" });
  });
});
