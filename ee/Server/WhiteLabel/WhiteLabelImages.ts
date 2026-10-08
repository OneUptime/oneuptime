import BadDataException from "Common/Types/Exception/BadDataException";
import MimeType from "Common/Types/File/MimeType";

/*
 * The three images a white-labelled installation can have, and what each may
 * be: the logo for light backgrounds, the logo for dark backgrounds and the
 * browser tab icon.
 *
 * A master admin uploads one as a data: URL. It is decoded, its type is read
 * from its own first bytes - never from the name or the type the browser
 * claimed - and it is checked against the image's types and size before it
 * is stored, as a data: URL again, with the type that was read. The same
 * rules read it back (parseStoredImage), so a value that would not pass today
 * is never served, whatever wrote the row.
 *
 * Pure: no database, no request.
 */

export enum WhiteLabelImageKind {
  Logo = "logo",
  DarkLogo = "darkLogo",
  Favicon = "favicon",
}

export interface WhiteLabelImage {
  // The type read from the image's own bytes.
  type: string;
  bytes: Buffer;
}

export interface WhiteLabelImageDefinition {
  kind: WhiteLabelImageKind;
  // The image in a sentence: "The logo must be ...".
  name: string;
  types: ReadonlyArray<string>;
  maxBytes: number;
  typeMessage: string;
  tooLargeMessage: string;
  unreadableMessage: string;
  unsafeSvgMessage: string;
}

export const WHITE_LABEL_LOGO_MAX_BYTES: number = 512 * 1024;
export const WHITE_LABEL_FAVICON_MAX_BYTES: number = 128 * 1024;

const LOGO_TYPES: ReadonlyArray<string> = [
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.svg,
];

const FAVICON_TYPES: ReadonlyArray<string> = [...LOGO_TYPES, MimeType.ico];

/*
 * The types every mail client draws. A logo of another type (SVG, WebP) is
 * still shown on every page; an email shows the product name in its place.
 */
export const EMAIL_SAFE_IMAGE_TYPES: ReadonlyArray<string> = [
  MimeType.png,
  MimeType.jpeg,
  MimeType.gif,
];

const defineImage: (data: {
  kind: WhiteLabelImageKind;
  name: string;
  types: ReadonlyArray<string>;
  typeList: string;
  maxBytes: number;
  sizeText: string;
}) => WhiteLabelImageDefinition = (data: {
  kind: WhiteLabelImageKind;
  name: string;
  types: ReadonlyArray<string>;
  typeList: string;
  maxBytes: number;
  sizeText: string;
}): WhiteLabelImageDefinition => {
  return {
    kind: data.kind,
    name: data.name,
    types: data.types,
    maxBytes: data.maxBytes,
    typeMessage: `The ${data.name} must be a ${data.typeList} image.`,
    tooLargeMessage: `The ${data.name} must be ${data.sizeText} or smaller.`,
    unreadableMessage: `The ${data.name} could not be read. Upload the image again.`,
    unsafeSvgMessage: `The ${data.name} is an SVG with scripts, event handlers or embedded HTML in it. Remove them, or upload a PNG instead.`,
  };
};

export const WHITE_LABEL_LOGO: WhiteLabelImageDefinition = defineImage({
  kind: WhiteLabelImageKind.Logo,
  name: "logo",
  types: LOGO_TYPES,
  typeList: "PNG, JPEG, GIF, WebP or SVG",
  maxBytes: WHITE_LABEL_LOGO_MAX_BYTES,
  sizeText: "512 KB",
});

export const WHITE_LABEL_DARK_LOGO: WhiteLabelImageDefinition = defineImage({
  kind: WhiteLabelImageKind.DarkLogo,
  name: "logo for dark backgrounds",
  types: LOGO_TYPES,
  typeList: "PNG, JPEG, GIF, WebP or SVG",
  maxBytes: WHITE_LABEL_LOGO_MAX_BYTES,
  sizeText: "512 KB",
});

export const WHITE_LABEL_FAVICON: WhiteLabelImageDefinition = defineImage({
  kind: WhiteLabelImageKind.Favicon,
  name: "browser tab icon",
  types: FAVICON_TYPES,
  typeList: "PNG, JPEG, GIF, WebP, SVG or ICO",
  maxBytes: WHITE_LABEL_FAVICON_MAX_BYTES,
  sizeText: "128 KB",
});

export const WHITE_LABEL_IMAGES: ReadonlyArray<WhiteLabelImageDefinition> = [
  WHITE_LABEL_LOGO,
  WHITE_LABEL_DARK_LOGO,
  WHITE_LABEL_FAVICON,
];

const DATA_URL_PREFIX: string = "data:";
const BASE64_MARKER: string = ";base64,";
const BASE64_TEXT: RegExp = /^[A-Za-z0-9+/]*={0,2}$/;
const WHITESPACE_RUNS: RegExp = /\s+/g;
const BYTE_ORDER_MARK: string = "﻿";

// The first bytes of each raster type.
const startsWithBytes: (bytes: Buffer, signature: Array<number>) => boolean = (
  bytes: Buffer,
  signature: Array<number>,
): boolean => {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every((value: number, index: number): boolean => {
    return bytes[index] === value;
  });
};

const startsWithText: (
  bytes: Buffer,
  text: string,
  offset?: number,
) => boolean = (bytes: Buffer, text: string, offset: number = 0): boolean => {
  return (
    bytes.length >= offset + text.length &&
    bytes.toString("latin1", offset, offset + text.length) === text
  );
};

/*
 * An SVG is text: an XML declaration, a comment or a doctype, then an <svg>
 * element. Read as UTF-8 without a byte order mark, it must start with "<"
 * and hold an <svg> start tag.
 */
const readSvgText: (bytes: Buffer) => string | null = (
  bytes: Buffer,
): string | null => {
  let text: string = bytes.toString("utf8");

  if (text.startsWith(BYTE_ORDER_MARK)) {
    text = text.substring(1);
  }

  const trimmed: string = text.trimStart();

  if (!trimmed.startsWith("<")) {
    return null;
  }

  return trimmed.toLowerCase().includes("<svg") ? trimmed : null;
};

/*
 * The parts of an SVG that do anything but draw. An image drawn with <img>
 * or as a favicon runs none of them, and the routes serve SVG with a
 * sandboxing Content-Security-Policy, but an SVG holding them is refused all
 * the same: nothing a logo needs is lost, and nothing that could run is kept.
 * Plain substring checks on the lower-cased text - no regular expression runs
 * over an upload.
 */
const UNSAFE_SVG_PARTS: ReadonlyArray<string> = [
  "<script",
  "javascript:",
  "<foreignobject",
  "<iframe",
  "<embed",
  "<object",
  "<!entity",
  "<?xml-stylesheet",
];

// An event handler attribute: whitespace, "on", letters, optional spaces, "=".
const hasEventHandlerAttribute: (lowerCaseText: string) => boolean = (
  lowerCaseText: string,
): boolean => {
  let index: number = lowerCaseText.indexOf("on");

  while (index !== -1) {
    const before: string = lowerCaseText.charAt(index - 1);

    if (
      index > 0 &&
      (before === " " ||
        before === "\n" ||
        before === "\t" ||
        before === "\r" ||
        before === "/")
    ) {
      let cursor: number = index + 2;
      let letters: number = 0;

      while (
        cursor < lowerCaseText.length &&
        lowerCaseText.charCodeAt(cursor) >= 97 &&
        lowerCaseText.charCodeAt(cursor) <= 122
      ) {
        cursor++;
        letters++;
      }

      while (
        cursor < lowerCaseText.length &&
        (lowerCaseText.charAt(cursor) === " " ||
          lowerCaseText.charAt(cursor) === "\t" ||
          lowerCaseText.charAt(cursor) === "\n" ||
          lowerCaseText.charAt(cursor) === "\r")
      ) {
        cursor++;
      }

      if (letters > 0 && lowerCaseText.charAt(cursor) === "=") {
        return true;
      }
    }

    index = lowerCaseText.indexOf("on", index + 2);
  }

  return false;
};

export const isUnsafeSvg: (svgText: string) => boolean = (
  svgText: string,
): boolean => {
  const lowerCaseText: string = svgText.toLowerCase();

  return (
    UNSAFE_SVG_PARTS.some((part: string): boolean => {
      return lowerCaseText.includes(part);
    }) || hasEventHandlerAttribute(lowerCaseText)
  );
};

/*
 * The type of an image, read from its own first bytes, or null when it is
 * none of the types any branding image may be.
 */
export const sniffImageType: (bytes: Buffer) => string | null = (
  bytes: Buffer,
): string | null => {
  if (
    startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  ) {
    return MimeType.png;
  }

  if (startsWithBytes(bytes, [0xff, 0xd8, 0xff])) {
    return MimeType.jpeg;
  }

  if (startsWithText(bytes, "GIF87a") || startsWithText(bytes, "GIF89a")) {
    return MimeType.gif;
  }

  if (startsWithText(bytes, "RIFF") && startsWithText(bytes, "WEBP", 8)) {
    return MimeType.webp;
  }

  // An ICO header: reserved 0, type 1 (icon), at least one image.
  if (
    startsWithBytes(bytes, [0x00, 0x00, 0x01, 0x00]) &&
    bytes.length >= 6 &&
    (bytes[4] !== 0 || bytes[5] !== 0)
  ) {
    return MimeType.ico;
  }

  if (readSvgText(bytes) !== null) {
    return MimeType.svg;
  }

  return null;
};

export const toDataUrl: (image: WhiteLabelImage) => string = (
  image: WhiteLabelImage,
): string => {
  return `${DATA_URL_PREFIX}${image.type}${BASE64_MARKER}${image.bytes.toString("base64")}`;
};

/*
 * The bytes of a base64 data: URL, or null when it is not one. The length is
 * checked before anything is decoded, so an upload far over the limit costs
 * no decoding at all.
 */
const decodeDataUrl: (
  value: string,
  maxBytes: number,
) => { bytes: Buffer } | "too-large" | null = (
  value: string,
  maxBytes: number,
): { bytes: Buffer } | "too-large" | null => {
  if (!value.startsWith(DATA_URL_PREFIX)) {
    return null;
  }

  const markerIndex: number = value.indexOf(BASE64_MARKER);

  if (markerIndex === -1 || markerIndex > 200) {
    return null;
  }

  const base64: string = value
    .substring(markerIndex + BASE64_MARKER.length)
    .replace(WHITESPACE_RUNS, "");

  // Four characters per three bytes, and up to two of padding.
  if (base64.length > Math.ceil(maxBytes / 3) * 4) {
    return "too-large";
  }

  if (
    base64.length === 0 ||
    base64.length % 4 !== 0 ||
    !BASE64_TEXT.test(base64)
  ) {
    return null;
  }

  return { bytes: Buffer.from(base64, "base64") };
};

/*
 * An uploaded image, checked: decoded, typed from its own bytes, and held to
 * the image's types and size. Throws BadDataException with the image's own
 * sentence.
 */
export const parseUploadedImage: (
  value: unknown,
  image: WhiteLabelImageDefinition,
) => WhiteLabelImage = (
  value: unknown,
  image: WhiteLabelImageDefinition,
): WhiteLabelImage => {
  if (typeof value !== "string") {
    throw new BadDataException(image.unreadableMessage);
  }

  const decoded: { bytes: Buffer } | "too-large" | null = decodeDataUrl(
    value.trim(),
    image.maxBytes,
  );

  if (decoded === "too-large") {
    throw new BadDataException(image.tooLargeMessage);
  }

  if (!decoded) {
    throw new BadDataException(image.unreadableMessage);
  }

  if (decoded.bytes.length > image.maxBytes) {
    throw new BadDataException(image.tooLargeMessage);
  }

  const type: string | null = sniffImageType(decoded.bytes);

  if (!type || !image.types.includes(type)) {
    throw new BadDataException(image.typeMessage);
  }

  if (type === MimeType.svg) {
    const svgText: string | null = readSvgText(decoded.bytes);

    if (!svgText || isUnsafeSvg(svgText)) {
      throw new BadDataException(image.unsafeSvgMessage);
    }
  }

  return { type, bytes: decoded.bytes };
};

/*
 * A stored image, read back under the same rules, or null when the stored
 * value would not pass them (whatever wrote it): it is then not served.
 */
export const parseStoredImage: (
  value: unknown,
  image: WhiteLabelImageDefinition,
) => WhiteLabelImage | null = (
  value: unknown,
  image: WhiteLabelImageDefinition,
): WhiteLabelImage | null => {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }

  try {
    return parseUploadedImage(value, image);
  } catch {
    return null;
  }
};
