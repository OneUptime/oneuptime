import MimeType from "../File/MimeType";

/*
 * A form's branding: the logo at the top of its public page and the icon in
 * the browser tab while the page is open. "Can you please add a branding
 * section to the form so they can upload their own logos and stuff? By
 * default, we can have the oneuptime logo." - the maintainer.
 *
 * Until a form has a logo of its own, its page shows the OneUptime logo, and
 * until it has a favicon, the tab shows OneUptime's. The images are Files,
 * uploaded the way a status page's logo and favicon are, and a form points
 * at them with logoFileId and faviconFileId. Every write that points a form
 * at one is checked (FormService): the file must exist, be an image every
 * browser draws, and weigh 1 MB at most.
 *
 * The public page is anonymous, so how the images reach it matters more
 * than anything else here. They are never served at an address of their own
 * and never by a file's id: they travel inside the form itself, base64, in
 * the answer to the one request the page already makes for its questions
 * (GET /api/form/public/:shareKey). So a form's logo can be read only
 * through that form, by a request that passed every check the form's
 * questions are behind - the form's own page header, the rate limits, the
 * form's switch, its plan and its IP allowlist - and a File is never made
 * public for it. The page draws them as data: URLs, and an image drawn that
 * way runs nothing, an SVG included.
 *
 * Pure, with no database or React imports: the server shapes and checks the
 * images with it, the public page reads them with it, and the dashboard's
 * preview draws them with it.
 */

// The image types a form's logo or favicon may be: those every browser draws.
export const FORM_BRANDING_IMAGE_TYPES: ReadonlyArray<string> = [
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.svg,
];

/*
 * The most a logo or a favicon may weigh. They are sent inside the form
 * itself, so a visitor downloads them every time the page opens; a logo
 * needs a few dozen kilobytes, and nothing an image of this size shows
 * needs more.
 */
export const FORM_BRANDING_IMAGE_MAX_BYTES: number = 1024 * 1024;

// The logo's alt text fits the column that holds it (ShortText).
export const FORM_LOGO_ALT_TEXT_MAX_LENGTH: number = 100;

/*
 * Why a write is refused, per image: whole sentences, so the docs can quote
 * them and nobody has to put one together from pieces.
 */
export const FORM_LOGO_TYPE_MESSAGE: string =
  "The logo must be a PNG, JPEG, GIF, WebP or SVG image.";
export const FORM_LOGO_TOO_LARGE_MESSAGE: string =
  "The logo must be 1 MB or smaller.";
export const FORM_LOGO_NOT_FOUND_MESSAGE: string =
  "The logo's file could not be found. Upload the logo again.";

export const FORM_FAVICON_TYPE_MESSAGE: string =
  "The favicon must be a PNG, JPEG, GIF, WebP or SVG image.";
export const FORM_FAVICON_TOO_LARGE_MESSAGE: string =
  "The favicon must be 1 MB or smaller.";
export const FORM_FAVICON_NOT_FOUND_MESSAGE: string =
  "The favicon's file could not be found. Upload the favicon again.";

export enum FormBrandingImageKind {
  Logo = "Logo",
  Favicon = "Favicon",
}

// One of a form's images: the columns that hold it and how refusals name it.
export interface FormBrandingImageDefinition {
  kind: FormBrandingImageKind;
  // The relation to the File (what the dashboard's forms write).
  relationColumn: "logoFile" | "faviconFile";
  // The File's id (what a server-side caller, or the API, writes).
  idColumn: "logoFileId" | "faviconFileId";
  // Names the image in a refusal of conflicting references.
  name: string;
  typeMessage: string;
  tooLargeMessage: string;
  notFoundMessage: string;
}

export const FORM_LOGO_IMAGE: FormBrandingImageDefinition = {
  kind: FormBrandingImageKind.Logo,
  relationColumn: "logoFile",
  idColumn: "logoFileId",
  name: "logo",
  typeMessage: FORM_LOGO_TYPE_MESSAGE,
  tooLargeMessage: FORM_LOGO_TOO_LARGE_MESSAGE,
  notFoundMessage: FORM_LOGO_NOT_FOUND_MESSAGE,
};

export const FORM_FAVICON_IMAGE: FormBrandingImageDefinition = {
  kind: FormBrandingImageKind.Favicon,
  relationColumn: "faviconFile",
  idColumn: "faviconFileId",
  name: "favicon",
  typeMessage: FORM_FAVICON_TYPE_MESSAGE,
  tooLargeMessage: FORM_FAVICON_TOO_LARGE_MESSAGE,
  notFoundMessage: FORM_FAVICON_NOT_FOUND_MESSAGE,
};

export const FORM_BRANDING_IMAGES: ReadonlyArray<FormBrandingImageDefinition> =
  [FORM_LOGO_IMAGE, FORM_FAVICON_IMAGE];

// Every column of a form that holds its branding.
export const FORM_BRANDING_COLUMNS: ReadonlyArray<string> = [
  "logoFile",
  "logoFileId",
  "logoAltText",
  "faviconFile",
  "faviconFileId",
];

/*
 * An image as the public page is told it: its type and its bytes. Drawn
 * with getPublicFormImageUrl.
 */
export interface PublicFormImage {
  // One of FORM_BRANDING_IMAGE_TYPES.
  type: string;
  // The image's bytes, base64.
  data: string;
}

// What the public page is told about a form's branding. Each only when set.
export interface PublicFormBranding {
  // Shown at the top of the page, in place of the OneUptime logo.
  logo?: PublicFormImage | undefined;
  // What the logo says, for screen readers. Only with a logo.
  logoAltText?: string | undefined;
  // The browser tab's icon while the page is open.
  favicon?: PublicFormImage | undefined;
}

export type IsFormBrandingImageTypeFunction = (value: unknown) => boolean;

export const isFormBrandingImageType: IsFormBrandingImageTypeFunction = (
  value: unknown,
): boolean => {
  return (
    typeof value === "string" &&
    FORM_BRANDING_IMAGE_TYPES.includes(value.trim().toLowerCase())
  );
};

type IsByteArrayFunction = (value: unknown) => value is Array<number>;

const isByteArray: IsByteArrayFunction = (
  value: unknown,
): value is Array<number> => {
  return (
    Array.isArray(value) &&
    value.every((byte: unknown): boolean => {
      return (
        typeof byte === "number" &&
        Number.isInteger(byte) &&
        byte >= 0 &&
        byte <= 255
      );
    })
  );
};

type IsPlainObjectFunction = (
  value: unknown,
) => value is Record<string, unknown>;

const isPlainObject: IsPlainObjectFunction = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

export type GetFileBytesFunction = (value: unknown) => Uint8Array | null;

/**
 * A stored file's bytes, however they arrived: a Buffer or any typed array
 * (Postgres, on the server), the JSON a Buffer turns into
 * ({ type: "Buffer", data: [...] }), the API's wrapper around that
 * ({ _type: "Buffer", value: ... }), or a plain list of bytes. Null for
 * anything else.
 */
export const getFileBytes: GetFileBytesFunction = (
  value: unknown,
): Uint8Array | null => {
  if (!value) {
    return null;
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (isByteArray(value)) {
    return Uint8Array.from(value);
  }

  if (!isPlainObject(value)) {
    return null;
  }

  if (value["type"] === "Buffer" && isByteArray(value["data"])) {
    return Uint8Array.from(value["data"]);
  }

  if (value["_type"] === "Buffer") {
    return getFileBytes(value["value"]);
  }

  return null;
};

// btoa takes a string of one character per byte, built in slices this long.
const BASE64_SLICE: number = 0x8000;

export type EncodeBase64Function = (bytes: Uint8Array) => string;

// The bytes as base64: with Buffer where there is one (Node), else with btoa.
export const encodeBase64: EncodeBase64Function = (
  bytes: Uint8Array,
): string => {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      .toString("base64");
  }

  let binary: string = "";

  for (let start: number = 0; start < bytes.length; start += BASE64_SLICE) {
    binary += String.fromCharCode(
      ...Array.from(bytes.subarray(start, start + BASE64_SLICE)),
    );
  }

  return btoa(binary);
};

type DrawableImage = {
  // One of FORM_BRANDING_IMAGE_TYPES, in lower case.
  type: string;
  bytes: Uint8Array;
};

type ReadDrawableImageFunction = (file: unknown) => DrawableImage | null;

// A stored image ({ file, fileType }) a page may draw, or null.
const readDrawableImage: ReadDrawableImageFunction = (
  file: unknown,
): DrawableImage | null => {
  if (!isPlainObject(file) || !isFormBrandingImageType(file["fileType"])) {
    return null;
  }

  const bytes: Uint8Array | null = getFileBytes(file["file"]);

  if (
    !bytes ||
    bytes.byteLength === 0 ||
    bytes.byteLength > FORM_BRANDING_IMAGE_MAX_BYTES
  ) {
    return null;
  }

  return {
    type: (file["fileType"] as string).trim().toLowerCase(),
    bytes: bytes,
  };
};

export type GetFormBrandingImageProblemFunction = (data: {
  image: FormBrandingImageDefinition;
  // The File the write points the form at, or null when there is none.
  file: { fileType?: unknown; file?: unknown } | null | undefined;
}) => string | null;

/**
 * Why a File cannot be a form's logo or favicon, or null when it can: it
 * must exist, be one of FORM_BRANDING_IMAGE_TYPES, hold bytes, and weigh
 * FORM_BRANDING_IMAGE_MAX_BYTES at most.
 */
export const getFormBrandingImageProblem: GetFormBrandingImageProblemFunction =
  (data: {
    image: FormBrandingImageDefinition;
    file: { fileType?: unknown; file?: unknown } | null | undefined;
  }): string | null => {
    if (!data.file) {
      return data.image.notFoundMessage;
    }

    if (!isFormBrandingImageType(data.file.fileType)) {
      return data.image.typeMessage;
    }

    const bytes: Uint8Array | null = getFileBytes(data.file.file);

    if (!bytes || bytes.byteLength === 0) {
      return data.image.notFoundMessage;
    }

    if (bytes.byteLength > FORM_BRANDING_IMAGE_MAX_BYTES) {
      return data.image.tooLargeMessage;
    }

    return null;
  };

export type GetPublicFormImageFunction = (
  file: unknown,
) => PublicFormImage | undefined;

/**
 * A stored image ({ file, fileType }) as the public page is told it, or
 * undefined when it is not one the page may draw - checked again here,
 * whatever a write let through, so the page is only ever handed an image of
 * an allowed type and size.
 */
export const getPublicFormImage: GetPublicFormImageFunction = (
  file: unknown,
): PublicFormImage | undefined => {
  const image: DrawableImage | null = readDrawableImage(file);

  if (!image) {
    return undefined;
  }

  return {
    type: image.type,
    data: encodeBase64(image.bytes),
  };
};

export type ReadFormLogoAltTextFunction = (value: unknown) => string | undefined;

// The logo's alt text, trimmed and capped; undefined when there is none.
export const readFormLogoAltText: ReadFormLogoAltTextFunction = (
  value: unknown,
): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const text: string = value.trim().slice(0, FORM_LOGO_ALT_TEXT_MAX_LENGTH);

  return text.length > 0 ? text : undefined;
};

export type GetPublicFormBrandingFunction = (data: {
  logoFile?: unknown;
  logoAltText?: unknown;
  faviconFile?: unknown;
}) => PublicFormBranding;

/**
 * What the public page is told about a form's branding, from the form as
 * stored: only what is set, so a form without branding is told nothing more
 * than before. The alt text goes only with a logo.
 */
export const getPublicFormBranding: GetPublicFormBrandingFunction = (data: {
  logoFile?: unknown;
  logoAltText?: unknown;
  faviconFile?: unknown;
}): PublicFormBranding => {
  const branding: PublicFormBranding = {};

  const logo: PublicFormImage | undefined = getPublicFormImage(data.logoFile);

  if (logo) {
    branding.logo = logo;

    const altText: string | undefined = readFormLogoAltText(data.logoAltText);

    if (altText) {
      branding.logoAltText = altText;
    }
  }

  const favicon: PublicFormImage | undefined = getPublicFormImage(
    data.faviconFile,
  );

  if (favicon) {
    branding.favicon = favicon;
  }

  return branding;
};

// Base64 as btoa writes it: groups of four, padded with "=".
const BASE64_PATTERN: RegExp = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// The longest base64 an image of the most a form's image may weigh takes.
const BASE64_MAX_LENGTH: number =
  Math.ceil(FORM_BRANDING_IMAGE_MAX_BYTES / 3) * 4;

export type ReadPublicFormImageFunction = (
  value: unknown,
) => PublicFormImage | undefined;

/**
 * An image as the public page reads it from the server's answer: drawn only
 * when it is an allowed type and real base64 of an allowed size, so nothing
 * the page was handed can turn its data: URL into something else.
 */
export const readPublicFormImage: ReadPublicFormImageFunction = (
  value: unknown,
): PublicFormImage | undefined => {
  if (
    !isPlainObject(value) ||
    !isFormBrandingImageType(value["type"]) ||
    typeof value["data"] !== "string"
  ) {
    return undefined;
  }

  const data: string = value["data"];

  if (
    data.length === 0 ||
    data.length > BASE64_MAX_LENGTH ||
    !BASE64_PATTERN.test(data)
  ) {
    return undefined;
  }

  return {
    type: (value["type"] as string).trim().toLowerCase(),
    data: data,
  };
};

export type GetPublicFormImageUrlFunction = (image: PublicFormImage) => string;

// An image as an <img> or a tab icon draws it.
export const getPublicFormImageUrl: GetPublicFormImageUrlFunction = (
  image: PublicFormImage,
): string => {
  return `data:${image.type};base64,${image.data}`;
};
