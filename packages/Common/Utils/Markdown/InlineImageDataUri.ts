/*
 * AN IMAGE THAT CARRIES ITSELF: data:image/png;base64,iVBORw0KGgo...
 *
 * This is how a synthetic monitor's screenshot reaches an incident or an
 * alert. The probe reports each screenshot as base64 text
 * ({{syntheticResponses.0.screenshots.<name>}}), and the only place a
 * description template can put that text is an image of its own:
 *
 *   ![Login page](data:image/png;base64,{{syntheticResponses.0.screenshots.login}})
 *
 * Such an image is not fetched from anywhere, so it cannot tell anybody who
 * looked or when, and a raster image cannot run anything. The email renderer
 * (Server/Types/Markdown) and the dashboard's Markdown viewer therefore show
 * one, while every other data: URL stays as blocked as before: a data: link
 * of any kind, an SVG (a document that can carry script and load other
 * resources), HTML, text, and anything that only claims to be an image.
 *
 * What counts as an inline image here:
 *   - "data:", then a media type of image/png, image/jpeg (or image/jpg),
 *     image/gif or image/webp, with no parameters, then ";base64,";
 *   - then base64 in the standard alphabet, padded to a multiple of four
 *     characters, as Buffer.toString("base64") writes it;
 *   - whose bytes start like a PNG, JPEG, GIF or WebP file does.
 *
 * The bytes, not the media type, decide what the image is. A template writes
 * "image/png" for every screenshot, but a script may take a JPEG
 * (page.screenshot({ type: "jpeg" })), and browsers show it anyway because
 * they read the bytes too. So any of the four media types is accepted, and
 * the image is reported - and written out again, in `dataUri` - as the type
 * its bytes are.
 *
 * Pure, with no Node or browser APIs: the dashboard and the server both use it.
 * Linear in the length of the URL, and no regular expression runs over the
 * data (see isBase64).
 */

export type InlineImageMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/gif"
  | "image/webp";

export interface InlineImageDataUri {
  // What the image's bytes are, whatever its URL said.
  mimeType: InlineImageMimeType;
  // The usual file extension for that type, without the dot.
  fileExtension: string;
  // The base64 data, exactly as it was in the URL.
  base64: string;
  // How many bytes the base64 data decodes to.
  byteLength: number;
  /*
   * The URL written out again from the parts above: "data:", the type the
   * bytes are, ";base64," and the data. It holds only letters, digits and
   * "+/=:;,", so it can go into an HTML attribute as it is.
   */
  dataUri: string;
}

const DATA_URI_PREFIX_PATTERN: RegExp =
  /^data:image\/(?:png|jpe?g|gif|webp);base64,/i;

const BASE64_ALPHABET: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

// How many leading bytes the signatures below need: WebP's is 12 long.
const SIGNATURE_BYTE_COUNT: number = 12;

interface ImageSignature {
  mimeType: InlineImageMimeType;
  fileExtension: string;
  // The bytes a file of this type starts with; null matches any byte.
  bytes: ReadonlyArray<number | null>;
}

const IMAGE_SIGNATURES: ReadonlyArray<ImageSignature> = [
  {
    mimeType: "image/png",
    fileExtension: "png",
    bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  },
  {
    mimeType: "image/jpeg",
    fileExtension: "jpg",
    bytes: [0xff, 0xd8, 0xff],
  },
  {
    // "GIF87a"
    mimeType: "image/gif",
    fileExtension: "gif",
    bytes: [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
  },
  {
    // "GIF89a"
    mimeType: "image/gif",
    fileExtension: "gif",
    bytes: [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
  },
  {
    // "RIFF", the file's size, then "WEBP"
    mimeType: "image/webp",
    fileExtension: "webp",
    bytes: [
      0x52,
      0x49,
      0x46,
      0x46,
      null,
      null,
      null,
      null,
      0x57,
      0x45,
      0x42,
      0x50,
    ],
  },
];

const EQUALS_SIGN: number = "=".charCodeAt(0);

// Whether a UTF-16 code unit is in base64's standard alphabet.
export const isBase64Character: (code: number) => boolean = (
  code: number,
): boolean => {
  return (
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x2b || // +
    code === 0x2f // /
  );
};

/*
 * Whether `base64` is base64 in the standard alphabet - at least one
 * character of it, then at most two "=" - as Buffer.toString("base64")
 * writes it.
 *
 * A loop, not a regular expression. V8 matches one with a backtracking
 * stack that can grow with every character a quantifier takes, and once a
 * long-running process has compiled enough code, V8 stops optimizing the
 * regular expressions it compiles. /^[A-Za-z0-9+/]+={0,2}$/ then ran out of
 * stack - "Maximum call stack size exceeded" - on a screenshot of three
 * megabytes. This uses the same small stack at any length.
 */
const isBase64: (base64: string) => boolean = (base64: string): boolean => {
  let end: number = base64.length;

  for (
    let padding: number = 0;
    padding < 2 && end > 0 && base64.charCodeAt(end - 1) === EQUALS_SIGN;
    padding++
  ) {
    end--;
  }

  if (end === 0) {
    return false;
  }

  for (let index: number = 0; index < end; index++) {
    if (!isBase64Character(base64.charCodeAt(index))) {
      return false;
    }
  }

  return true;
};

/*
 * The first `byteCount` bytes `base64` decodes to (fewer when it is shorter).
 * Only the characters those bytes need are read, so this is constant time
 * whatever the length of the data. `base64` is already known to be valid.
 */
const decodeLeadingBytes: (
  base64: string,
  byteCount: number,
) => Array<number> = (base64: string, byteCount: number): Array<number> => {
  const bytes: Array<number> = [];
  let bits: number = 0;
  let bitCount: number = 0;

  for (
    let index: number = 0;
    index < base64.length && bytes.length < byteCount;
    index++
  ) {
    const character: string = base64[index]!;

    if (character === "=") {
      break;
    }

    bits = (bits << 6) | BASE64_ALPHABET.indexOf(character);
    bitCount += 6;

    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((bits >> bitCount) & 0xff);
      // Keep only the bits not yet read, so `bits` never grows.
      bits &= (1 << bitCount) - 1;
    }
  }

  return bytes;
};

const findSignature: (bytes: Array<number>) => ImageSignature | null = (
  bytes: Array<number>,
): ImageSignature | null => {
  for (const signature of IMAGE_SIGNATURES) {
    if (bytes.length < signature.bytes.length) {
      continue;
    }

    const matches: boolean = signature.bytes.every(
      (expected: number | null, index: number): boolean => {
        return expected === null || bytes[index] === expected;
      },
    );

    if (matches) {
      return signature;
    }
  }

  return null;
};

export type ParseInlineImageDataUriFunction = (
  url: string | null | undefined,
) => InlineImageDataUri | null;

/**
 * The inline raster image `url` carries (see above), or null when it is not
 * one: any other scheme or media type, a media type with parameters, data
 * that is not base64 or not padded, or bytes that are not a PNG, JPEG, GIF
 * or WebP file.
 */
export const parseInlineImageDataUri: ParseInlineImageDataUriFunction = (
  url: string | null | undefined,
): InlineImageDataUri | null => {
  if (typeof url !== "string") {
    return null;
  }

  const prefix: RegExpMatchArray | null = url.match(DATA_URI_PREFIX_PATTERN);

  if (!prefix) {
    return null;
  }

  const base64: string = url.slice(prefix[0].length);

  if (base64.length % 4 !== 0 || !isBase64(base64)) {
    return null;
  }

  const signature: ImageSignature | null = findSignature(
    decodeLeadingBytes(base64, SIGNATURE_BYTE_COUNT),
  );

  if (!signature) {
    return null;
  }

  const padding: number = base64.endsWith("==")
    ? 2
    : base64.endsWith("=")
      ? 1
      : 0;

  return {
    mimeType: signature.mimeType,
    fileExtension: signature.fileExtension,
    base64: base64,
    byteLength: (base64.length / 4) * 3 - padding,
    dataUri: `data:${signature.mimeType};base64,${base64}`,
  };
};
