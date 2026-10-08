import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { getProductBranding } from "Common/UI/Utils/ProductBranding";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Admin Dashboard's side of the white-label settings: whether this
 * installation may white-label itself at all, and the two calls the settings
 * page makes (ee/Server/WhiteLabel/API/WhiteLabelAPI.ts).
 *
 * Whether it may comes from env.js, which carries PRODUCT_BRANDING only when
 * the license allows white-labelling. Nothing is asked of the server to find
 * out: an installation whose license does not allow it never sends a single
 * request that names white-labelling, so nothing in its browser hints at it.
 */

export const WHITE_LABEL_SETTINGS_PAGE_PATH: string = "white-label";

export const isWhiteLabelAvailable: () => boolean = (): boolean => {
  return getProductBranding() !== null;
};

// The image types and limits the server holds uploads to (WhiteLabelImages.ts).
export enum WhiteLabelImageSlot {
  Logo = "logo",
  DarkLogo = "darkLogo",
  Favicon = "favicon",
}

export interface WhiteLabelImageRule {
  slot: WhiteLabelImageSlot;
  // For the file picker.
  accept: string;
  maxBytes: number;
  // The server's own sentence, said here before anything is uploaded.
  tooLargeMessage: string;
  formats: string;
}

const LOGO_ACCEPT: string =
  "image/png,image/jpeg,image/gif,image/webp,image/svg+xml,.png,.jpg,.jpeg,.gif,.webp,.svg";

export const WHITE_LABEL_IMAGE_RULES: Readonly<
  Record<WhiteLabelImageSlot, WhiteLabelImageRule>
> = {
  [WhiteLabelImageSlot.Logo]: {
    slot: WhiteLabelImageSlot.Logo,
    accept: LOGO_ACCEPT,
    maxBytes: 512 * 1024,
    tooLargeMessage: "The logo must be 512 KB or smaller.",
    formats: "PNG, JPEG, GIF, WebP or SVG, up to 512 KB",
  },
  [WhiteLabelImageSlot.DarkLogo]: {
    slot: WhiteLabelImageSlot.DarkLogo,
    accept: LOGO_ACCEPT,
    maxBytes: 512 * 1024,
    tooLargeMessage: "The logo for dark backgrounds must be 512 KB or smaller.",
    formats: "PNG, JPEG, GIF, WebP or SVG, up to 512 KB",
  },
  [WhiteLabelImageSlot.Favicon]: {
    slot: WhiteLabelImageSlot.Favicon,
    accept: `${LOGO_ACCEPT},image/x-icon,image/vnd.microsoft.icon,.ico`,
    maxBytes: 128 * 1024,
    tooLargeMessage: "The browser tab icon must be 128 KB or smaller.",
    formats: "PNG, ICO, SVG, GIF, JPEG or WebP, up to 128 KB",
  },
};

export interface WhiteLabelImageInfo {
  type: string;
  sizeInBytes: number;
  // A path on this host.
  url: string;
}

export interface WhiteLabelSettingsView {
  productName: string | null;
  websiteUrl: string | null;
  logo: WhiteLabelImageInfo | null;
  darkLogo: WhiteLabelImageInfo | null;
  favicon: WhiteLabelImageInfo | null;
}

/*
 * A change to save: a key that is absent is left as it is, null clears it.
 * An image is a data: URL.
 */
export interface WhiteLabelSettingsChange {
  productName?: string | null | undefined;
  websiteUrl?: string | null | undefined;
  logo?: string | null | undefined;
  darkLogo?: string | null | undefined;
  favicon?: string | null | undefined;
}

export const getWhiteLabelSettingsUrl: () => URL = (): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute("/branding/settings");
};

const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value.length > 0 ? value : null;
};

const readImage: (value: unknown) => WhiteLabelImageInfo | null = (
  value: unknown,
): WhiteLabelImageInfo | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const image: Record<string, unknown> = value as Record<string, unknown>;
  const url: string | null = readText(image["url"]);

  // Only a path on this host is drawn.
  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return null;
  }

  return {
    type: readText(image["type"]) || "",
    sizeInBytes:
      typeof image["sizeInBytes"] === "number" ? image["sizeInBytes"] : 0,
    url,
  };
};

export const parseWhiteLabelSettingsView: (
  data: JSONObject | null | undefined,
) => WhiteLabelSettingsView = (
  data: JSONObject | null | undefined,
): WhiteLabelSettingsView => {
  const body: JSONObject = data || {};

  return {
    productName: readText(body["productName"]),
    websiteUrl: readText(body["websiteUrl"]),
    logo: readImage(body["logo"]),
    darkLogo: readImage(body["darkLogo"]),
    favicon: readImage(body["favicon"]),
  };
};

export const fetchWhiteLabelSettings: () => Promise<WhiteLabelSettingsView> =
  async (): Promise<WhiteLabelSettingsView> => {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: getWhiteLabelSettingsUrl(),
      });

    if (response instanceof HTTPErrorResponse) {
      throw response;
    }

    return parseWhiteLabelSettingsView(response.data as JSONObject);
  };

export const saveWhiteLabelSettings: (
  change: WhiteLabelSettingsChange,
) => Promise<WhiteLabelSettingsView> = async (
  change: WhiteLabelSettingsChange,
): Promise<WhiteLabelSettingsView> => {
  const data: JSONObject = {};

  for (const [key, value] of Object.entries(change)) {
    if (value !== undefined) {
      data[key] = value;
    }
  }

  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.put<JSONObject>({
      url: getWhiteLabelSettingsUrl(),
      data,
    });

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return parseWhiteLabelSettingsView(response.data as JSONObject);
};

// A picked file as a data: URL, the shape the server takes an image in.
export const readFileAsDataUrl: (file: File) => Promise<string> = (
  file: File,
): Promise<string> => {
  return new Promise<string>(
    (resolve: (value: string) => void, reject: (error: Error) => void) => {
      const reader: FileReader = new FileReader();

      reader.onload = (): void => {
        if (typeof reader.result === "string") {
          resolve(reader.result);
          return;
        }

        reject(new Error("The image could not be read. Choose it again."));
      };

      reader.onerror = (): void => {
        reject(new Error("The image could not be read. Choose it again."));
      };

      reader.readAsDataURL(file);
    },
  );
};
