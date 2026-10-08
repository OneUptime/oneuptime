import { describe, expect, test } from "@jest/globals";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import { ProductBranding } from "Common/Types/Branding/ProductBranding";
import PartialEntity from "Common/Types/Database/PartialEntity";
import BadDataException from "Common/Types/Exception/BadDataException";
import MimeType from "Common/Types/File/MimeType";
import { JSONObject } from "Common/Types/JSON";
import { WhiteLabelImageKind } from "../../../Server/WhiteLabel/WhiteLabelImages";
import {
  EMPTY_WHITE_LABEL_SETTINGS,
  getWhiteLabelImagePath,
  NOTHING_TO_SAVE_MESSAGE,
  parseWhiteLabelSettingsUpdate,
  readWhiteLabelSettings,
  toProductBranding,
  toWhiteLabelSettingsResponse,
  WEBSITE_URL_MESSAGE,
  WEBSITE_URL_TOO_LONG_MESSAGE,
  WHITE_LABEL_IMAGE_ROUTES,
  WHITE_LABEL_SETTINGS_ROUTE,
  WhiteLabelSettings,
} from "../../../Server/WhiteLabel/WhiteLabelSettings";
import {
  ICO_BYTES,
  JPEG_BYTES,
  PNG_BYTES,
  SVG_TEXT,
  toDataUrlOf,
  WEBP_BYTES,
} from "./WhiteLabelFixtures";

/*
 * The white-label settings: what a change may say, how it becomes the
 * GlobalConfig branding columns, how stored values are read back (under
 * today's rules, so a bad stored value is never shown), and what core and the
 * settings page are told.
 */

const NOW: Date = new Date("2026-10-08T12:00:00.000Z");

const parse: (body: unknown) => PartialEntity<GlobalConfig> = (
  body: unknown,
): PartialEntity<GlobalConfig> => {
  return parseWhiteLabelSettingsUpdate(body, NOW);
};

const refusal: (body: unknown) => string = (body: unknown): string => {
  try {
    parse(body);
  } catch (err) {
    expect(err).toBeInstanceOf(BadDataException);
    return (err as Error).message;
  }

  throw new Error("The change was accepted.");
};

const configWith: (values: Record<string, unknown>) => GlobalConfig = (
  values: Record<string, unknown>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  Object.assign(config, values);
  return config;
};

describe("the routes", () => {
  test("live under /branding: neutral names, nothing a page's source would give away", () => {
    expect(WHITE_LABEL_SETTINGS_ROUTE).toBe("/branding/settings");
    expect(WHITE_LABEL_IMAGE_ROUTES).toEqual({
      [WhiteLabelImageKind.Logo]: "/branding/logo",
      [WhiteLabelImageKind.DarkLogo]: "/branding/dark-logo",
      [WhiteLabelImageKind.Favicon]: "/branding/favicon",
    });
  });

  test("an image's public path is under /api, with the version when there is one", () => {
    expect(getWhiteLabelImagePath(WhiteLabelImageKind.Logo, null)).toBe(
      "/api/branding/logo",
    );
    expect(getWhiteLabelImagePath(WhiteLabelImageKind.Favicon, 1234)).toBe(
      "/api/branding/favicon?v=1234",
    );
  });
});

describe("parseWhiteLabelSettingsUpdate: the product name", () => {
  test("is stored trimmed, with the time of the change", () => {
    expect(parse({ productName: "  Acme Monitoring  " })).toEqual({
      brandingProductName: "Acme Monitoring",
      brandingUpdatedAt: NOW,
    });
  });

  test.each([
    ["null", null],
    ["an empty string", ""],
    ["blanks", "   "],
  ])("is cleared by %s", (_label: string, value: unknown) => {
    expect(parse({ productName: value })).toEqual({
      brandingProductName: null,
      brandingUpdatedAt: NOW,
    });
  });

  test("takes 50 characters and refuses 51", () => {
    expect(parse({ productName: "A".repeat(50) }).brandingProductName).toBe(
      "A".repeat(50),
    );
    expect(refusal({ productName: "A".repeat(51) })).toBe(
      "The product name can be at most 50 characters.",
    );
  });

  test.each([
    ["a line break", "Acme\nMonitoring"],
    ["a tab", "Acme\tMonitoring"],
    ["a less-than sign", "Acme <Monitoring>"],
    ["template braces", "Acme {{x}}"],
    ["a C1 control character", "Acme\u0085"],
  ])("refuses a name with %s", (_label: string, value: string) => {
    expect(refusal({ productName: value })).toBe(
      "The product name can't contain line breaks or the characters < > { }.",
    );
  });

  test.each([
    "Acme & Co",
    'Acme "Watch"',
    "L'Observatoire",
    "Ünïcödé Monitör",
    "Acme $& $1 Monitoring",
    "監視サービス",
  ])("takes %s as it is (escaped where it is shown)", (value: string) => {
    expect(parse({ productName: value }).brandingProductName).toBe(value);
  });

  test("refuses a name that is not text", () => {
    expect(refusal({ productName: 42 })).toBe("The product name must be text.");
  });
});

describe("parseWhiteLabelSettingsUpdate: the website", () => {
  test.each(["https://acme.example", "http://acme.example/monitoring?x=1"])(
    "takes %s",
    (value: string) => {
      expect(parse({ websiteUrl: value }).brandingWebsiteUrl).toBe(value);
    },
  );

  test.each([
    ["no scheme", "acme.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["an ftp: URL", "ftp://acme.example"],
    ["a data: URL", "data:text/html,hi"],
    ["a protocol-relative URL", "//acme.example"],
    ["a user name and password", "https://user:secret@acme.example"],
    ["spaces", "https://acme example.com"],
  ])("refuses %s", (_label: string, value: string) => {
    expect(refusal({ websiteUrl: value })).toBe(WEBSITE_URL_MESSAGE);
  });

  test("refuses a website longer than 500 characters", () => {
    expect(
      refusal({ websiteUrl: `https://acme.example/${"a".repeat(500)}` }),
    ).toBe(WEBSITE_URL_TOO_LONG_MESSAGE);
  });

  test("is cleared by null or blanks", () => {
    expect(parse({ websiteUrl: null }).brandingWebsiteUrl).toBeNull();
    expect(parse({ websiteUrl: "  " }).brandingWebsiteUrl).toBeNull();
  });
});

describe("parseWhiteLabelSettingsUpdate: the images", () => {
  test("stores each image as a data: URL of the type its bytes say", () => {
    const update: PartialEntity<GlobalConfig> = parse({
      logo: toDataUrlOf(MimeType.png, JPEG_BYTES),
      darkLogo: toDataUrlOf(MimeType.svg, SVG_TEXT),
      favicon: toDataUrlOf(MimeType.ico, ICO_BYTES),
    });

    expect(update.brandingLogo).toBe(toDataUrlOf(MimeType.jpeg, JPEG_BYTES));
    expect(update.brandingDarkLogo).toBe(toDataUrlOf(MimeType.svg, SVG_TEXT));
    expect(update.brandingFavicon).toBe(toDataUrlOf(MimeType.ico, ICO_BYTES));
    expect(update.brandingUpdatedAt).toEqual(NOW);
  });

  test("clears an image with null or an empty string", () => {
    expect(parse({ logo: null, favicon: "" })).toEqual({
      brandingLogo: null,
      brandingFavicon: null,
      brandingUpdatedAt: NOW,
    });
  });

  test("refuses the whole change when one image cannot be used", () => {
    expect(
      refusal({
        productName: "Acme",
        favicon: toDataUrlOf(MimeType.png, "not an image"),
      }),
    ).toBe(
      "The browser tab icon must be a PNG, JPEG, GIF, WebP, SVG or ICO image.",
    );
  });
});

describe("parseWhiteLabelSettingsUpdate: only what the change names", () => {
  test("leaves out every key the change does not name", () => {
    expect(
      Object.keys(parse({ websiteUrl: "https://acme.example" })).sort(),
    ).toEqual(["brandingUpdatedAt", "brandingWebsiteUrl"]);
  });

  test("ignores keys that are not settings", () => {
    expect(
      Object.keys(
        parse({
          productName: "Acme",
          enterpriseLicenseToken: "forged",
          brandingProductName: "sneaky",
        }),
      ).sort(),
    ).toEqual(["brandingProductName", "brandingUpdatedAt"]);
    expect(
      parse({ productName: "Acme", brandingProductName: "sneaky" })
        .brandingProductName,
    ).toBe("Acme");
  });

  test.each([
    ["an empty body", {}],
    ["no body", null],
    ["a list", []],
    ["a string", "Acme"],
    ["only keys that are not settings", { enterpriseLicenseToken: "x" }],
  ])("refuses %s", (_label: string, body: unknown) => {
    expect(refusal(body)).toBe(NOTHING_TO_SAVE_MESSAGE);
  });
});

describe("readWhiteLabelSettings", () => {
  test("is empty with no row", () => {
    expect(readWhiteLabelSettings(null)).toEqual(EMPTY_WHITE_LABEL_SETTINGS);
  });

  test("reads every value that passes today's rules", () => {
    const updatedAt: Date = new Date("2026-10-01T00:00:00.000Z");
    const settings: WhiteLabelSettings = readWhiteLabelSettings(
      configWith({
        brandingProductName: "Acme",
        brandingWebsiteUrl: "https://acme.example",
        brandingLogo: toDataUrlOf(MimeType.png, PNG_BYTES),
        brandingDarkLogo: toDataUrlOf(MimeType.webp, WEBP_BYTES),
        brandingFavicon: toDataUrlOf(MimeType.ico, ICO_BYTES),
        brandingUpdatedAt: updatedAt,
      }),
    );

    expect(settings.productName).toBe("Acme");
    expect(settings.websiteUrl).toBe("https://acme.example");
    expect(settings.logo?.type).toBe(MimeType.png);
    expect(settings.darkLogo?.type).toBe(MimeType.webp);
    expect(settings.favicon?.type).toBe(MimeType.ico);
    expect(settings.updatedAt?.getTime()).toBe(updatedAt.getTime());
  });

  test("drops what would not pass today, whatever wrote it", () => {
    const settings: WhiteLabelSettings = readWhiteLabelSettings(
      configWith({
        brandingProductName: "Acme <script>",
        brandingWebsiteUrl: "javascript:alert(1)",
        brandingLogo: toDataUrlOf(MimeType.png, "<html>"),
        brandingFavicon: "not a data url",
        brandingUpdatedAt: "not a date",
      }),
    );

    expect(settings).toEqual(EMPTY_WHITE_LABEL_SETTINGS);
  });

  test("reads a date stored as text", () => {
    expect(
      readWhiteLabelSettings(
        configWith({ brandingUpdatedAt: "2026-10-01T00:00:00.000Z" }),
      ).updatedAt?.toISOString(),
    ).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("toProductBranding: what core is told", () => {
  const updatedAt: Date = new Date("2026-10-01T00:00:00.000Z");

  test("nothing set: nothing changes ({})", () => {
    expect(toProductBranding(EMPTY_WHITE_LABEL_SETTINGS)).toEqual({});
  });

  test("everything set: the name, the website and every image's versioned path", () => {
    const branding: ProductBranding = toProductBranding(
      readWhiteLabelSettings(
        configWith({
          brandingProductName: "Acme",
          brandingWebsiteUrl: "https://acme.example",
          brandingLogo: toDataUrlOf(MimeType.png, PNG_BYTES),
          brandingDarkLogo: toDataUrlOf(MimeType.svg, SVG_TEXT),
          brandingFavicon: toDataUrlOf(MimeType.ico, ICO_BYTES),
          brandingUpdatedAt: updatedAt,
        }),
      ),
    );

    expect(branding).toEqual({
      productName: "Acme",
      websiteUrl: "https://acme.example",
      logoUrl: `/api/branding/logo?v=${updatedAt.getTime()}`,
      darkLogoUrl: `/api/branding/dark-logo?v=${updatedAt.getTime()}`,
      faviconUrl: `/api/branding/favicon?v=${updatedAt.getTime()}`,
      isLogoEmailSafe: true,
    });
  });

  test.each([
    [MimeType.png, true, PNG_BYTES],
    [MimeType.jpeg, true, JPEG_BYTES],
    [MimeType.webp, false, WEBP_BYTES],
    [MimeType.svg, false, Buffer.from(SVG_TEXT)],
  ])(
    "a %s logo can go in an email: %s",
    (type: string, isEmailSafe: boolean, bytes: Buffer) => {
      expect(
        toProductBranding(
          readWhiteLabelSettings(
            configWith({ brandingLogo: toDataUrlOf(type, bytes) }),
          ),
        ).isLogoEmailSafe,
      ).toBe(isEmailSafe);
    },
  );
});

describe("toWhiteLabelSettingsResponse: what the settings page is told", () => {
  test("each value, and each image's type, size and address - never its bytes", () => {
    const updatedAt: Date = new Date("2026-10-01T00:00:00.000Z");
    const response: JSONObject = toWhiteLabelSettingsResponse(
      readWhiteLabelSettings(
        configWith({
          brandingProductName: "Acme",
          brandingLogo: toDataUrlOf(MimeType.png, PNG_BYTES),
          brandingUpdatedAt: updatedAt,
        }),
      ),
    );

    expect(response).toEqual({
      productName: "Acme",
      websiteUrl: null,
      logo: {
        type: MimeType.png,
        sizeInBytes: PNG_BYTES.length,
        url: `/api/branding/logo?v=${updatedAt.getTime()}`,
      },
      darkLogo: null,
      favicon: null,
      updatedAt: updatedAt.toISOString(),
    });
    expect(JSON.stringify(response)).not.toContain(
      PNG_BYTES.toString("base64"),
    );
  });
});
