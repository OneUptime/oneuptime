import { SeededRandom, seededRandom } from "./SeededRandom";
import sharp, { Metadata, OutputInfo, Sharp } from "sharp";

/*
 * LOGO FILES FOR THE TESTS OF THE LOGOS EMAILS CARRY.
 *
 * Real image files, made with the image library the server makes an
 * email's logo with (sharp; Server/Utils/Mail/EmailLogoImage.ts), so a
 * test reads back what a mail client would draw: each file's type, size
 * and pixels. Random pixels come from the suites' one seeded generator
 * (SeededRandom), so a file is the same on every run.
 *
 * Not a test file itself (jest only collects *.test.ts).
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  // 0 (transparent) to 1 (opaque).
  alpha: number;
}

export type LogoFileFormat = "png" | "jpeg" | "gif" | "webp" | "tiff" | "avif";

export const INDIGO: Rgba = { r: 79, g: 70, b: 229, alpha: 1 };
export const ORANGE: Rgba = { r: 249, g: 115, b: 22, alpha: 1 };
export const RED: Rgba = { r: 255, g: 0, b: 0, alpha: 1 };

// An image as a file of `format`.
const writeAs: (image: Sharp, format: LogoFileFormat) => Promise<Buffer> = (
  image: Sharp,
  format: LogoFileFormat,
): Promise<Buffer> => {
  switch (format) {
    case "png":
      return image.png().toBuffer();
    case "jpeg":
      return image.jpeg({ quality: 95 }).toBuffer();
    case "gif":
      return image.gif().toBuffer();
    case "webp":
      // Lossless, so a test reads back exactly the colours it wrote.
      return image.webp({ lossless: true }).toBuffer();
    case "tiff":
      return image.tiff().toBuffer();
    case "avif":
      return image.avif().toBuffer();
  }
};

// A logo of one colour.
export const solidLogo: (data: {
  width: number;
  height: number;
  format: LogoFileFormat;
  color: Rgba;
}) => Promise<Buffer> = (data: {
  width: number;
  height: number;
  format: LogoFileFormat;
  color: Rgba;
}): Promise<Buffer> => {
  return writeAs(
    sharp({
      create: {
        width: data.width,
        height: data.height,
        channels: 4,
        background: data.color,
      },
    }),
    data.format,
  );
};

/*
 * A logo whose left half is one colour and right half another: where each
 * colour went in an image made from it says the image was not cropped,
 * mirrored or turned.
 */
export const twoColourLogo: (data: {
  width: number;
  height: number;
  format: LogoFileFormat;
  left: Rgba;
  right: Rgba;
}) => Promise<Buffer> = async (data: {
  width: number;
  height: number;
  format: LogoFileFormat;
  left: Rgba;
  right: Rgba;
}): Promise<Buffer> => {
  const half: number = Math.floor(data.width / 2);
  const pixels: Buffer = Buffer.alloc(data.width * data.height * 4);

  for (let y: number = 0; y < data.height; y++) {
    for (let x: number = 0; x < data.width; x++) {
      const color: Rgba = x < half ? data.left : data.right;
      const offset: number = (y * data.width + x) * 4;

      pixels[offset] = color.r;
      pixels[offset + 1] = color.g;
      pixels[offset + 2] = color.b;
      pixels[offset + 3] = Math.round(color.alpha * 255);
    }
  }

  return writeAs(
    sharp(pixels, {
      raw: { width: data.width, height: data.height, channels: 4 },
    }),
    data.format,
  );
};

/*
 * A logo of random pixels, which compresses to about its raw size: three
 * bytes a pixel, so 1,200 x 300 of them is a file of about a megabyte.
 */
export const noiseLogo: (data: {
  width: number;
  height: number;
  format: "png" | "jpeg";
  seed: number;
}) => Promise<Buffer> = (data: {
  width: number;
  height: number;
  format: "png" | "jpeg";
  seed: number;
}): Promise<Buffer> => {
  const random: SeededRandom = seededRandom(data.seed);
  const pixels: Buffer = Buffer.alloc(data.width * data.height * 3);

  for (let index: number = 0; index < pixels.length; index++) {
    pixels[index] = random(256);
  }

  return writeAs(
    sharp(pixels, {
      raw: { width: data.width, height: data.height, channels: 3 },
    }),
    data.format,
  );
};

/*
 * A logo of square cells of random colours, `cell` pixels a side: a small
 * file, because each row repeats its cells, that grows when it is made
 * smaller - each new pixel blends the cells under it, and the repeats are
 * gone.
 */
export const cellsLogo: (data: {
  width: number;
  height: number;
  cell: number;
  seed: number;
}) => Promise<Buffer> = (data: {
  width: number;
  height: number;
  cell: number;
  seed: number;
}): Promise<Buffer> => {
  const random: SeededRandom = seededRandom(data.seed);
  const columns: number = Math.ceil(data.width / data.cell);
  const rows: number = Math.ceil(data.height / data.cell);
  const colors: Array<number> = Array.from(
    { length: columns * rows * 3 },
    (): number => {
      return random(256);
    },
  );
  const pixels: Buffer = Buffer.alloc(data.width * data.height * 3);

  for (let y: number = 0; y < data.height; y++) {
    for (let x: number = 0; x < data.width; x++) {
      const color: number =
        (Math.floor(y / data.cell) * columns + Math.floor(x / data.cell)) * 3;
      const offset: number = (y * data.width + x) * 3;

      pixels[offset] = colors[color]!;
      pixels[offset + 1] = colors[color + 1]!;
      pixels[offset + 2] = colors[color + 2]!;
    }
  }

  return sharp(pixels, {
    raw: { width: data.width, height: data.height, channels: 3 },
  })
    .png()
    .toBuffer();
};

// An animated GIF or WebP: one frame of each colour.
export const animatedLogo: (data: {
  width: number;
  height: number;
  colors: Array<Rgba>;
  format: "gif" | "webp";
}) => Promise<Buffer> = async (data: {
  width: number;
  height: number;
  colors: Array<Rgba>;
  format: "gif" | "webp";
}): Promise<Buffer> => {
  const frames: Array<Buffer> = await Promise.all(
    data.colors.map((color: Rgba): Promise<Buffer> => {
      return solidLogo({
        width: data.width,
        height: data.height,
        format: "png",
        color: color,
      });
    }),
  );

  return writeAs(sharp(frames, { join: { animated: true } }), data.format);
};

// An SVG file: `body` inside an <svg> with `attributes`.
export const svgLogo: (body: string, attributes?: string) => Buffer = (
  body: string,
  attributes: string = 'width="120" height="40" viewBox="0 0 120 40"',
): Buffer => {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${body}</svg>`,
    "utf8",
  );
};

export interface ImageFacts {
  format: string;
  width: number;
  height: number;
  pages: number;
  space: string;
  depth: string;
  hasAlpha: boolean;
  hasExif: boolean;
  orientation: number | undefined;
}

// What the image library reads an image file as.
export const imageFacts: (image: Buffer) => Promise<ImageFacts> = async (
  image: Buffer,
): Promise<ImageFacts> => {
  const metadata: Metadata = await sharp(image).metadata();

  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    pages: metadata.pages || 1,
    space: metadata.space,
    depth: metadata.depth,
    hasAlpha: Boolean(metadata.hasAlpha),
    hasExif: Boolean(metadata.exif),
    orientation: metadata.orientation,
  };
};

// The pixel at (x, y) of an image file, as a mail client draws it.
export const pixelAt: (image: Buffer, x: number, y: number) => Promise<Rgba> =
  async (image: Buffer, x: number, y: number): Promise<Rgba> => {
    const decoded: { data: Buffer; info: OutputInfo } = await sharp(
      image,
    )
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const offset: number = (y * decoded.info.width + x) * 4;

    return {
      r: decoded.data[offset]!,
      g: decoded.data[offset + 1]!,
      b: decoded.data[offset + 2]!,
      alpha: decoded.data[offset + 3]! / 255,
    };
  };

// Whether two colours are the same to the eye: each channel within `tolerance`.
export const isAbout: (
  actual: Rgba,
  expected: Rgba,
  tolerance?: number,
) => boolean = (
  actual: Rgba,
  expected: Rgba,
  tolerance: number = 6,
): boolean => {
  return (
    Math.abs(actual.r - expected.r) <= tolerance &&
    Math.abs(actual.g - expected.g) <= tolerance &&
    Math.abs(actual.b - expected.b) <= tolerance &&
    Math.abs(actual.alpha - expected.alpha) <= tolerance / 255
  );
};

// The names of a PNG file's chunks, in order.
export const pngChunkTypes: (png: Buffer) => Array<string> = (
  png: Buffer,
): Array<string> => {
  const types: Array<string> = [];
  let offset: number = 8;

  while (offset + 12 <= png.length) {
    types.push(png.toString("latin1", offset + 4, offset + 8));
    offset += 12 + png.readUInt32BE(offset);
  }

  return types;
};

// The bytes of a data: URL.
export const dataUriBytes: (dataUri: string) => Buffer = (
  dataUri: string,
): Buffer => {
  return Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
};
