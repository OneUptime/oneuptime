import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import Path from "path";
import {
  EMAIL_LOGO_PIXEL_DENSITY,
  EmailLogoBox,
  PRODUCT_EMAIL_LOGO_BOX,
  STATUS_PAGE_EMAIL_LOGO_BOX,
  toPixelBox,
} from "Common/Server/Utils/Mail/EmailLogoImage";

/*
 * A LOGO IS MADE FOR THE BOX ITS HEADER DRAWS IT IN.
 *
 * A logo an email carries that is not an image every mail client draws as
 * it is - an SVG, a WebP, a file over 512 KB - or that is larger than its
 * header needs is made into one sized for the header that draws it, three
 * image pixels to each pixel of the header's box (EmailLogoImage). The box
 * is the template's: a status page's emails draw its logo in CustomLogo,
 * at most 200 x 48, and every other email the installation's own logo in
 * Logo, 32 tall and at most 200 wide. A template that drew its logo larger
 * would get one made too small for it, blurred on every screen, and one
 * that drew it smaller would carry pixels nobody sees in every email. So
 * the boxes are held here to the templates' own styles.
 */

const PARTIALS: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates/Partials",
);

const readPartial: (name: string) => string = (name: string): string => {
  return fs.readFileSync(Path.join(PARTIALS, name), "utf8");
};

// The style of the <img> that starts with `start`, as the template writes it.
const imageStyle: (template: string, start: string) => string = (
  template: string,
  start: string,
): string => {
  const at: number = template.indexOf(start);

  expect(at).toBeGreaterThan(-1);
  // One such image in the template, so the box is the only one it draws.
  expect(template.indexOf(start, at + 1)).toBe(-1);

  const tag: string = template.slice(at, template.indexOf(">", at) + 1);
  const styleAt: number = tag.indexOf('style="');

  expect(styleAt).toBeGreaterThan(-1);

  return tag.slice(styleAt + 'style="'.length, tag.indexOf('"', styleAt + 7));
};

// A declaration's pixels, from a style such as "max-height: 48px".
const pixelsOf: (style: string, property: string) => number | null = (
  style: string,
  property: string,
): number | null => {
  for (const declaration of style.split(";")) {
    const colon: number = declaration.indexOf(":");

    if (colon === -1 || declaration.slice(0, colon).trim() !== property) {
      continue;
    }

    const value: string = declaration.slice(colon + 1).trim();

    return value.endsWith("px") ? Number(value.slice(0, -2)) : null;
  }

  return null;
};

describe("the boxes a carried logo is made for are the templates' own", () => {
  test("a status page's emails draw its logo at most 200 x 48 (CustomLogo)", () => {
    const style: string = imageStyle(
      readPartial("CustomLogo.hbs"),
      '<img src="{{logoUrl}}"',
    );

    const drawn: EmailLogoBox = {
      width: pixelsOf(style, "max-width") as number,
      height: pixelsOf(style, "max-height") as number,
    };

    expect(drawn).toEqual(STATUS_PAGE_EMAIL_LOGO_BOX);
    // It keeps its proportions inside the box.
    expect(style).toContain("height: auto;");
  });

  test("every other email draws the installation's own logo 32 tall and at most 200 wide (Logo)", () => {
    const style: string = imageStyle(
      readPartial("Logo.hbs"),
      '<img src="{{@root.brandLogoUrl}}"',
    );

    const drawn: EmailLogoBox = {
      width: pixelsOf(style, "max-width") as number,
      height: pixelsOf(style, "height") as number,
    };

    expect(drawn).toEqual(PRODUCT_EMAIL_LOGO_BOX);
    expect(style).toContain("width: auto;");
  });

  test("made three times over, crisp on a 3x screen: 600 x 144 and 600 x 96 pixels", () => {
    expect(EMAIL_LOGO_PIXEL_DENSITY).toBe(3);
    expect(toPixelBox(STATUS_PAGE_EMAIL_LOGO_BOX)).toEqual({
      width: 600,
      height: 144,
    });
    expect(toPixelBox(PRODUCT_EMAIL_LOGO_BOX)).toEqual({
      width: 600,
      height: 96,
    });
  });

  test("reads a style's pixels as a mail client does", () => {
    expect(pixelsOf("display: block; max-height: 48px", "max-height")).toBe(
      48,
    );
    expect(pixelsOf("height: auto; max-height: 48px", "height")).toBeNull();
    expect(pixelsOf("border: 0;", "max-width")).toBeNull();
  });
});
