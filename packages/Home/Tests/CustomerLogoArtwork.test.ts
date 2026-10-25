import { beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { JSDOM } from "jsdom";
import path from "path";
import zlib from "zlib";

/*
 * The customer logos in Static/img/customers, which the logo strip
 * (Views/logo-roll.ejs) shows on some fifty pages.
 *
 * Each began as a brand's own artwork - from its website, or from Wikimedia
 * Commons - and was redrawn in one ink (black, with white only to cut it out),
 * cropped to that ink, so the strip can show every one in the same grey at the
 * same weight. They are served from oneuptime.com, so an SVG among them must
 * not run anything or fetch anything: no scripts, no handlers, no stylesheet,
 * nothing outside the file it is in.
 */

const CUSTOMERS: string = path.join(
  __dirname,
  "..",
  "Static",
  "img",
  "customers",
);

const FILES: Array<string> = fs
  .readdirSync(CUSTOMERS)
  .filter((file: string) => {
    return !file.startsWith(".");
  })
  .sort();
const SVGS: Array<string> = FILES.filter((file: string) => {
  return file.endsWith(".svg");
});
const PNGS: Array<string> = FILES.filter((file: string) => {
  return file.endsWith(".png");
});

const SVG_NAMESPACE: string = "http://www.w3.org/2000/svg";

// Elements that run code, load something, or style the file from a sheet.
const FORBIDDEN_ELEMENTS: Array<string> = [
  "script",
  "foreignObject",
  "image",
  "feImage",
  "style",
  "iframe",
  "embed",
  "object",
  "audio",
  "video",
  "canvas",
  "a",
  "animate",
  "animateMotion",
  "animateTransform",
  "set",
  "discard",
  "handler",
  "listener",
  "font-face-uri",
];

// The paints one ink allows: black, white or grey (inside a mask), nothing, or a part of the file.
const PAINT: RegExp =
  /^(?:none|#000|#fff|rgb\((\d{1,3}),\1,\1\)|url\(#[\w.-]+\))$/;

// onclick, onload, onbegin...: an attribute a browser runs.
const EVENT_HANDLER: RegExp = /^on/i;

const svgIn: (file: string) => Document = (file: string): Document => {
  return new JSDOM(fs.readFileSync(path.join(CUSTOMERS, file), "utf8"), {
    contentType: "image/svg+xml",
  }).window.document;
};

const insideMask: (element: Element) => boolean = (
  element: Element,
): boolean => {
  return element.closest("mask") !== null;
};

test("there is a logo for the strip to show, and nothing but logos", () => {
  expect(SVGS.length + PNGS.length).toBe(FILES.length);
  expect(FILES.length).toBeGreaterThanOrEqual(30);

  for (const file of FILES) {
    // Lower-case words, joined with hyphens: the brand, as its address would spell it.
    expect(file).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*\.(?:svg|png)$/);
  }
});

test("all of it together stays small: about the weight of one photograph", () => {
  const bytes: number = FILES.reduce((total: number, file: string): number => {
    return total + fs.statSync(path.join(CUSTOMERS, file)).size;
  }, 0);

  expect(bytes).toBeLessThan(200 * 1024);
});

describe.each(SVGS)("%s", (file: string) => {
  let source: string;
  let document: Document;
  let svg: Element;
  let elements: Array<Element>;

  beforeAll(() => {
    source = fs.readFileSync(path.join(CUSTOMERS, file), "utf8");
    // Throws on anything that is not well-formed XML.
    document = svgIn(file);
    svg = document.documentElement;
    elements = [svg, ...Array.from(svg.querySelectorAll("*"))];
  });

  test("is an SVG document and nothing else", () => {
    expect(svg.localName).toBe("svg");
    expect(svg.namespaceURI).toBe(SVG_NAMESPACE);
    expect(document.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(source.trimStart().startsWith("<svg")).toBe(true);
    // No DOCTYPE, entity, or stylesheet instruction - nothing for a parser to fetch or expand.
    expect(source).not.toMatch(/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet/i);
    expect(source).not.toContain("<!--");
  });

  test("declares its size in the proportions of its view box, 64 pixels tall", () => {
    const viewBox: Array<number> = (svg.getAttribute("viewBox") || "")
      .trim()
      .split(/[\s,]+/)
      .map(Number);

    expect(viewBox).toHaveLength(4);
    expect(viewBox.every(Number.isFinite)).toBe(true);
    expect(viewBox[2]).toBeGreaterThan(0);
    expect(viewBox[3]).toBeGreaterThan(0);
    expect(svg.getAttribute("height")).toBe("64");

    const width: number = Number(svg.getAttribute("width"));

    expect(width).toBeCloseTo((64 * viewBox[2]!) / viewBox[3]!, 1);
  });

  test("runs nothing", () => {
    for (const element of elements) {
      expect([
        element.localName,
        FORBIDDEN_ELEMENTS.includes(element.localName),
      ]).toEqual([element.localName, false]);
      expect(element.namespaceURI).toBe(SVG_NAMESPACE);

      for (const attribute of Array.from(element.attributes)) {
        expect([
          attribute.name,
          EVENT_HANDLER.test(attribute.localName),
        ]).toEqual([attribute.name, false]);
        expect(attribute.value).not.toMatch(/javascript:|data:/i);
      }
    }
  });

  test("loads nothing: every reference is to a part of this file", () => {
    for (const element of elements) {
      for (const attribute of Array.from(element.attributes)) {
        if (attribute.localName === "href") {
          expect(attribute.value).toMatch(/^#[\w.-]+$/);
          expect(
            document.getElementById(attribute.value.slice(1)),
          ).not.toBeNull();
        }

        for (const reference of attribute.value.match(/url\([^)]*\)/g) || []) {
          expect(reference).toMatch(/^url\(#[\w.-]+\)$/);
          expect(
            document.getElementById(reference.slice(5, -1)),
          ).not.toBeNull();
        }
      }
    }
  });

  test("carries its paint in attributes, with no stylesheet to read it from", () => {
    for (const element of elements) {
      expect([element.localName, element.hasAttribute("style")]).toEqual([
        element.localName,
        false,
      ]);
      expect([element.localName, element.hasAttribute("class")]).toEqual([
        element.localName,
        false,
      ]);
    }
  });

  test("is one ink: black, and white or grey only in the mask that cuts it out", () => {
    let painted: number = 0;

    for (const element of elements) {
      for (const property of ["fill", "stroke"]) {
        const paint: string | null = element.getAttribute(property);

        if (paint === null) {
          continue;
        }

        expect([property, paint, PAINT.test(paint)]).toEqual([
          property,
          paint,
          true,
        ]);

        if (paint !== "none" && paint !== "#000" && !paint.startsWith("url(")) {
          expect([paint, insideMask(element)]).toEqual([paint, true]);
        }

        if (paint === "#000" || (paint !== "none" && !insideMask(element))) {
          painted++;
        }
      }
    }

    // Something is drawn in the ink itself, or through the mask.
    expect(painted).toBeGreaterThan(0);
  });

  test("draws through its mask in the ink, when it has one", () => {
    const masks: Array<Element> = Array.from(svg.querySelectorAll("mask"));

    for (const mask of masks) {
      const users: Array<Element> = elements.filter((element: Element) => {
        return element.getAttribute("mask") === `url(#${mask.id})`;
      });

      expect(users.length).toBeGreaterThan(0);

      for (const user of users) {
        if (!insideMask(user)) {
          expect(user.getAttribute("fill")).toBe("#000");
        }
      }
    }
  });

  test("weighs a few kilobytes", () => {
    expect(source.length).toBeLessThan(12 * 1024);
  });
});

interface Png {
  width: number;
  height: number;
  colourType: number;
  bitDepth: number;
  interlace: number;
  chunks: Array<string>;
  // Two bytes a pixel, grey then alpha, row after row.
  pixels: Buffer;
}

// Undoes the per-row filter PNG compresses with (the specification's section 9).
const unfilter: (
  raw: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
) => Buffer = (
  raw: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer => {
  const stride: number = width * bytesPerPixel;
  const pixels: Buffer = Buffer.alloc(stride * height);

  for (let y: number = 0; y < height; y++) {
    const filter: number = raw[y * (stride + 1)]!;

    for (let x: number = 0; x < stride; x++) {
      const value: number = raw[y * (stride + 1) + 1 + x]!;
      const left: number =
        x >= bytesPerPixel ? pixels[y * stride + x - bytesPerPixel]! : 0;
      const up: number = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upLeft: number =
        x >= bytesPerPixel && y > 0
          ? pixels[(y - 1) * stride + x - bytesPerPixel]!
          : 0;
      let predictor: number = 0;

      if (filter === 1) {
        predictor = left;
      } else if (filter === 2) {
        predictor = up;
      } else if (filter === 3) {
        predictor = (left + up) >> 1;
      } else if (filter === 4) {
        const estimate: number = left + up - upLeft;
        const toLeft: number = Math.abs(estimate - left);
        const toUp: number = Math.abs(estimate - up);
        const toUpLeft: number = Math.abs(estimate - upLeft);

        predictor =
          toLeft <= toUp && toLeft <= toUpLeft
            ? left
            : toUp <= toUpLeft
              ? up
              : upLeft;
      } else if (filter !== 0) {
        throw new Error(`Unknown PNG filter ${filter} on row ${y}`);
      }

      pixels[y * stride + x] = (value + predictor) & 0xff;
    }
  }

  return pixels;
};

const readPng: (file: string) => Png = (file: string): Png => {
  const png: Buffer = fs.readFileSync(path.join(CUSTOMERS, file));

  expect(png.subarray(0, 8)).toEqual(
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );

  const chunks: Array<string> = [];
  const data: Array<Buffer> = [];
  let header: Buffer | null = null;

  for (let offset: number = 8; offset < png.length; ) {
    const length: number = png.readUInt32BE(offset);
    const type: string = png.toString("ascii", offset + 4, offset + 8);
    const body: Buffer = png.subarray(offset + 8, offset + 8 + length);

    chunks.push(type);

    if (type === "IHDR") {
      header = body;
    } else if (type === "IDAT") {
      data.push(body);
    }

    offset += length + 12;
  }

  const width: number = header!.readUInt32BE(0);
  const height: number = header!.readUInt32BE(4);

  return {
    width,
    height,
    bitDepth: header![8]!,
    colourType: header![9]!,
    interlace: header![12]!,
    chunks,
    pixels: unfilter(zlib.inflateSync(Buffer.concat(data)), width, height, 2),
  };
};

describe.each(PNGS)("%s", (file: string) => {
  let png: Png;

  beforeAll(() => {
    png = readPng(file);
  });

  test("is eight-bit grey with alpha, not interlaced", () => {
    expect(png.colourType).toBe(4);
    expect(png.bitDepth).toBe(8);
    expect(png.interlace).toBe(0);
    expect(png.pixels.length).toBe(png.width * png.height * 2);
  });

  test("carries only its pixels: no text, no dates, no colour profile", () => {
    expect(png.chunks[0]).toBe("IHDR");
    expect(png.chunks[png.chunks.length - 1]).toBe("IEND");
    expect(
      png.chunks.filter((chunk: string) => {
        return chunk !== "IHDR" && chunk !== "IDAT" && chunk !== "IEND";
      }),
    ).toEqual([]);
  });

  test("is the ink alone: every pixel black, shaped by its alpha", () => {
    let inked: number = 0;
    let clear: number = 0;

    for (let index: number = 0; index < png.pixels.length; index += 2) {
      expect(png.pixels[index]).toBe(0);

      if (png.pixels[index + 1] === 255) {
        inked++;
      } else if (png.pixels[index + 1] === 0) {
        clear++;
      }
    }

    // A logo, not a box: solid ink and clear space both.
    expect(inked).toBeGreaterThan(png.width * png.height * 0.05);
    expect(clear).toBeGreaterThan(png.width * png.height * 0.2);
  });

  test("is cropped to its ink: nothing on the edge but a pixel or two of space", () => {
    const alphaAt: (x: number, y: number) => number = (
      x: number,
      y: number,
    ): number => {
      return png.pixels[(y * png.width + x) * 2 + 1]!;
    };
    const rowInked: (y: number) => boolean = (y: number): boolean => {
      for (let x: number = 0; x < png.width; x++) {
        if (alphaAt(x, y) > 0) {
          return true;
        }
      }
      return false;
    };
    const columnInked: (x: number) => boolean = (x: number): boolean => {
      for (let y: number = 0; y < png.height; y++) {
        if (alphaAt(x, y) > 0) {
          return true;
        }
      }
      return false;
    };

    // Within three pixels of each edge there is ink.
    expect([0, 1, 2, 3].some(rowInked)).toBe(true);
    expect(
      [0, 1, 2, 3].some((offset: number) => {
        return rowInked(png.height - 1 - offset);
      }),
    ).toBe(true);
    expect([0, 1, 2, 3].some(columnInked)).toBe(true);
    expect(
      [0, 1, 2, 3].some((offset: number) => {
        return columnInked(png.width - 1 - offset);
      }),
    ).toBe(true);
  });

  test("weighs a few kilobytes", () => {
    expect(fs.statSync(path.join(CUSTOMERS, file)).size).toBeLessThan(
      16 * 1024,
    );
  });
});
