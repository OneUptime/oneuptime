import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Select from "Common/Server/Types/Database/Select";
import ProductBrandingUtil, {
  ProductBranding,
} from "Common/Types/Branding/ProductBranding";
import PartialEntity from "Common/Types/Database/PartialEntity";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import {
  EMAIL_SAFE_IMAGE_TYPES,
  parseStoredImage,
  parseUploadedImage,
  toDataUrl,
  WHITE_LABEL_DARK_LOGO,
  WHITE_LABEL_FAVICON,
  WHITE_LABEL_LOGO,
  WhiteLabelImage,
  WhiteLabelImageDefinition,
  WhiteLabelImageKind,
} from "./WhiteLabelImages";

/*
 * A white-labelled installation's settings: the product name, the website a
 * "Powered by" line links to, and the three images. Stored in GlobalConfig's
 * branding columns (core schema, written only as root), read and written
 * only through this area's routes.
 *
 * Pure: no database, no request.
 */

// Where the routes live, under "/api".
export const WHITE_LABEL_SETTINGS_ROUTE: string = "/branding/settings";

export const WHITE_LABEL_IMAGE_ROUTES: Readonly<
  Record<WhiteLabelImageKind, string>
> = {
  [WhiteLabelImageKind.Logo]: "/branding/logo",
  [WhiteLabelImageKind.DarkLogo]: "/branding/dark-logo",
  [WhiteLabelImageKind.Favicon]: "/branding/favicon",
};

// The public paths the frontends and emails use (the API is mounted at /api).
export const getWhiteLabelImagePath: (
  kind: WhiteLabelImageKind,
  version: number | null,
) => string = (kind: WhiteLabelImageKind, version: number | null): string => {
  const path: string = `/api${WHITE_LABEL_IMAGE_ROUTES[kind]}`;

  return version === null ? path : `${path}?v=${version}`;
};

export const WEBSITE_URL_MAX_LENGTH: number = 500;

export const WEBSITE_URL_MESSAGE: string =
  "The website must be a web address that starts with http:// or https://.";

export const WEBSITE_URL_TOO_LONG_MESSAGE: string = `The website can be at most ${WEBSITE_URL_MAX_LENGTH} characters.`;

export const NOTHING_TO_SAVE_MESSAGE: string =
  "Send the product name, the website or an image to change.";

export interface WhiteLabelSettings {
  productName: string | null;
  websiteUrl: string | null;
  logo: WhiteLabelImage | null;
  darkLogo: WhiteLabelImage | null;
  favicon: WhiteLabelImage | null;
  // When anything last changed; part of every image's address.
  updatedAt: Date | null;
}

export const EMPTY_WHITE_LABEL_SETTINGS: WhiteLabelSettings = {
  productName: null,
  websiteUrl: null,
  logo: null,
  darkLogo: null,
  favicon: null,
  updatedAt: null,
};

// The GlobalConfig columns the settings are read from.
export const WHITE_LABEL_SETTINGS_SELECT: Select<GlobalConfig> = {
  _id: true,
  brandingProductName: true,
  brandingWebsiteUrl: true,
  brandingLogo: true,
  brandingDarkLogo: true,
  brandingFavicon: true,
  brandingUpdatedAt: true,
};

interface ImageColumn {
  definition: WhiteLabelImageDefinition;
  // The request body's key and the settings' key.
  key: "logo" | "darkLogo" | "favicon";
  column: "brandingLogo" | "brandingDarkLogo" | "brandingFavicon";
}

const IMAGE_COLUMNS: ReadonlyArray<ImageColumn> = [
  { definition: WHITE_LABEL_LOGO, key: "logo", column: "brandingLogo" },
  {
    definition: WHITE_LABEL_DARK_LOGO,
    key: "darkLogo",
    column: "brandingDarkLogo",
  },
  {
    definition: WHITE_LABEL_FAVICON,
    key: "favicon",
    column: "brandingFavicon",
  },
];

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

// A text field of the request: undefined leaves it, null or blank clears it.
const readTextField: (
  body: Record<string, unknown>,
  key: string,
  name: string,
) => string | null | undefined = (
  body: Record<string, unknown>,
  key: string,
  name: string,
): string | null | undefined => {
  const value: unknown = body[key];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new BadDataException(`The ${name} must be text.`);
  }

  const trimmed: string = value.trim();

  return trimmed.length > 0 ? trimmed : null;
};

export const getWebsiteUrlProblem: (value: string) => string | null = (
  value: string,
): string | null => {
  if (value.length > WEBSITE_URL_MAX_LENGTH) {
    return WEBSITE_URL_TOO_LONG_MESSAGE;
  }

  if (!ProductBrandingUtil.isWebsiteUrl(value)) {
    return WEBSITE_URL_MESSAGE;
  }

  try {
    const url: URL = new URL(value);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return WEBSITE_URL_MESSAGE;
    }

    // A website, not a credential: no user name or password in it.
    if (url.username || url.password) {
      return WEBSITE_URL_MESSAGE;
    }
  } catch {
    return WEBSITE_URL_MESSAGE;
  }

  return null;
};

/*
 * A request to change the settings, checked and turned into the columns to
 * write. Only what the request names changes: a key that is absent is left
 * alone, null (or blank text) clears it. Throws BadDataException with a
 * whole sentence for the first thing that cannot be saved.
 */
export const parseWhiteLabelSettingsUpdate: (
  body: unknown,
  now: Date,
) => PartialEntity<GlobalConfig> = (
  body: unknown,
  now: Date,
): PartialEntity<GlobalConfig> => {
  if (!isPlainObject(body)) {
    throw new BadDataException(NOTHING_TO_SAVE_MESSAGE);
  }

  const update: PartialEntity<GlobalConfig> = {};

  const productName: string | null | undefined = readTextField(
    body,
    "productName",
    "product name",
  );

  if (productName !== undefined) {
    if (productName !== null) {
      const problem: string | null =
        ProductBrandingUtil.getProductNameProblem(productName);

      if (problem) {
        throw new BadDataException(problem);
      }
    }

    update.brandingProductName = productName;
  }

  const websiteUrl: string | null | undefined = readTextField(
    body,
    "websiteUrl",
    "website",
  );

  if (websiteUrl !== undefined) {
    if (websiteUrl !== null) {
      const problem: string | null = getWebsiteUrlProblem(websiteUrl);

      if (problem) {
        throw new BadDataException(problem);
      }
    }

    update.brandingWebsiteUrl = websiteUrl;
  }

  for (const imageColumn of IMAGE_COLUMNS) {
    const value: unknown = body[imageColumn.key];

    if (value === undefined) {
      continue;
    }

    if (value === null || value === "") {
      (update as Record<string, unknown>)[imageColumn.column] = null;
      continue;
    }

    (update as Record<string, unknown>)[imageColumn.column] = toDataUrl(
      parseUploadedImage(value, imageColumn.definition),
    );
  }

  if (Object.keys(update).length === 0) {
    throw new BadDataException(NOTHING_TO_SAVE_MESSAGE);
  }

  update.brandingUpdatedAt = now;

  return update;
};

/*
 * The settings as stored, read under today's rules: a value that would not
 * pass them now is left out rather than shown.
 */
export const readWhiteLabelSettings: (
  config: GlobalConfig | null,
) => WhiteLabelSettings = (config: GlobalConfig | null): WhiteLabelSettings => {
  if (!config) {
    return { ...EMPTY_WHITE_LABEL_SETTINGS };
  }

  const productName: string | null =
    typeof config.brandingProductName === "string" &&
    config.brandingProductName.trim().length > 0 &&
    ProductBrandingUtil.getProductNameProblem(
      config.brandingProductName.trim(),
    ) === null
      ? config.brandingProductName.trim()
      : null;

  const websiteUrl: string | null =
    typeof config.brandingWebsiteUrl === "string" &&
    getWebsiteUrlProblem(config.brandingWebsiteUrl.trim()) === null
      ? config.brandingWebsiteUrl.trim()
      : null;

  const storedUpdatedAt: unknown = config.brandingUpdatedAt;
  const updatedAt: Date | null = storedUpdatedAt
    ? new Date(storedUpdatedAt as Date | string)
    : null;

  return {
    productName,
    websiteUrl,
    logo: parseStoredImage(config.brandingLogo, WHITE_LABEL_LOGO),
    darkLogo: parseStoredImage(config.brandingDarkLogo, WHITE_LABEL_DARK_LOGO),
    favicon: parseStoredImage(config.brandingFavicon, WHITE_LABEL_FAVICON),
    updatedAt:
      updatedAt && !Number.isNaN(updatedAt.getTime()) ? updatedAt : null,
  };
};

const getVersion: (settings: WhiteLabelSettings) => number | null = (
  settings: WhiteLabelSettings,
): number | null => {
  return settings.updatedAt ? settings.updatedAt.getTime() : null;
};

/*
 * What core is told: each piece only when it is set, so an installation that
 * may white-label but has set nothing yet shows OneUptime's own everywhere.
 */
export const toProductBranding: (
  settings: WhiteLabelSettings,
) => ProductBranding = (settings: WhiteLabelSettings): ProductBranding => {
  const version: number | null = getVersion(settings);
  const branding: ProductBranding = {};

  if (settings.productName) {
    branding.productName = settings.productName;
  }

  if (settings.websiteUrl) {
    branding.websiteUrl = settings.websiteUrl;
  }

  if (settings.logo) {
    branding.logoUrl = getWhiteLabelImagePath(
      WhiteLabelImageKind.Logo,
      version,
    );
    branding.isLogoEmailSafe = EMAIL_SAFE_IMAGE_TYPES.includes(
      settings.logo.type,
    );
  }

  if (settings.darkLogo) {
    branding.darkLogoUrl = getWhiteLabelImagePath(
      WhiteLabelImageKind.DarkLogo,
      version,
    );
  }

  if (settings.favicon) {
    branding.faviconUrl = getWhiteLabelImagePath(
      WhiteLabelImageKind.Favicon,
      version,
    );
  }

  return branding;
};

const describeImage: (
  image: WhiteLabelImage | null,
  kind: WhiteLabelImageKind,
  version: number | null,
) => JSONObject | null = (
  image: WhiteLabelImage | null,
  kind: WhiteLabelImageKind,
  version: number | null,
): JSONObject | null => {
  if (!image) {
    return null;
  }

  return {
    type: image.type,
    sizeInBytes: image.bytes.length,
    url: getWhiteLabelImagePath(kind, version),
  };
};

// What the settings page is told: the values, and each image's address and size.
export const toWhiteLabelSettingsResponse: (
  settings: WhiteLabelSettings,
) => JSONObject = (settings: WhiteLabelSettings): JSONObject => {
  const version: number | null = getVersion(settings);

  return {
    productName: settings.productName,
    websiteUrl: settings.websiteUrl,
    logo: describeImage(settings.logo, WhiteLabelImageKind.Logo, version),
    darkLogo: describeImage(
      settings.darkLogo,
      WhiteLabelImageKind.DarkLogo,
      version,
    ),
    favicon: describeImage(
      settings.favicon,
      WhiteLabelImageKind.Favicon,
      version,
    ),
    updatedAt: settings.updatedAt ? settings.updatedAt.toISOString() : null,
  };
};

export const getWhiteLabelImage: (
  settings: WhiteLabelSettings,
  kind: WhiteLabelImageKind,
) => WhiteLabelImage | null = (
  settings: WhiteLabelSettings,
  kind: WhiteLabelImageKind,
): WhiteLabelImage | null => {
  switch (kind) {
    case WhiteLabelImageKind.Logo:
      return settings.logo;
    case WhiteLabelImageKind.DarkLogo:
      return settings.darkLogo;
    case WhiteLabelImageKind.Favicon:
      return settings.favicon;
    default:
      return null;
  }
};
