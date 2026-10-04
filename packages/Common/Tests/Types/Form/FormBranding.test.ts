import MimeType from "../../../Types/File/MimeType";
import {
  encodeBase64,
  FORM_BRANDING_COLUMNS,
  FORM_BRANDING_IMAGES,
  FORM_FAVICON_IMAGE,
  FORM_FAVICON_IMAGE_TYPES,
  FORM_FAVICON_MAX_BYTES,
  FORM_FAVICON_NOT_FOUND_MESSAGE,
  FORM_FAVICON_TOO_LARGE_MESSAGE,
  FORM_FAVICON_TYPE_MESSAGE,
  FORM_LOGO_ALT_TEXT_MAX_LENGTH,
  FORM_LOGO_IMAGE,
  FORM_LOGO_IMAGE_TYPES,
  FORM_LOGO_MAX_BYTES,
  FORM_LOGO_NOT_FOUND_MESSAGE,
  FORM_LOGO_TOO_LARGE_MESSAGE,
  FORM_LOGO_TYPE_MESSAGE,
  FormBrandingImageDefinition,
  FormBrandingImageKind,
  getBase64MaxLength,
  getFileBytes,
  getFormBrandingImageProblem,
  getPublicFormBranding,
  getPublicFormImage,
  getPublicFormImageUrl,
  isFormBrandingImageType,
  PublicFormBranding,
  PublicFormImage,
  readFormLogoAltText,
  readPublicFormImage,
} from "../../../Types/Form/FormBranding";
import {
  BuiltPublicForm,
  buildPublicForm,
} from "../../../Types/Form/FormPublic";
import FormTargetType from "../../../Types/Form/FormTargetType";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A form's branding (Forms > a form > Build > Branding): the logo its page
 * shows in place of the OneUptime logo, the logo's alt text, and the tab's
 * favicon. These are the rules every side holds them to:
 *
 *   - a write may point a form only at a File that exists, is an image
 *     every browser draws and is small - a logo 512 KB at most, a favicon
 *     128 KB (getFormBrandingImageProblem; whose project the file is in is
 *     FormService's to check);
 *   - the public page is told only what is set, the images base64, and an
 *     image the rules refuse is never told at all, whatever a row holds
 *     (getPublicFormBranding);
 *   - the page draws only an allowed type in real base64 of an allowed size,
 *     whatever it was handed (readPublicFormImage), as a data: URL.
 */

// The first bytes of a PNG, then some more: what the tests upload.
const PNG_BYTES: Array<number> = [
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
];
const PNG_BASE64: string = Buffer.from(PNG_BYTES).toString("base64");

// The first bytes of an ICO: reserved, type 1 (icon), one image.
const ICO_BYTES: Array<number> = [0x00, 0x00, 0x01, 0x00, 0x01, 0x00];
const ICO_BASE64: string = Buffer.from(ICO_BYTES).toString("base64");

const SVG_TEXT: string =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';

function pngFile(): { file: Buffer; fileType: string } {
  return { file: Buffer.from(PNG_BYTES), fileType: MimeType.png };
}

function icoFile(): { file: Buffer; fileType: string } {
  return { file: Buffer.from(ICO_BYTES), fileType: MimeType.ico };
}

const originalBuffer: typeof Buffer = Buffer;

afterEach(() => {
  (globalThis as unknown as { Buffer: typeof Buffer }).Buffer = originalBuffer;
});

// Never an image, for either: documents, pages and formats browsers do not all draw.
const NEVER_AN_IMAGE: Array<unknown> = [
  MimeType.pdf,
  MimeType.txt,
  MimeType.json,
  MimeType.zip,
  MimeType.bmp,
  MimeType.heic,
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml;charset=utf-8",
  "",
  undefined,
  null,
  42,
];

describe("the rules", () => {
  test("a logo is a PNG, JPEG, GIF, WebP or SVG image", () => {
    expect([...FORM_LOGO_IMAGE_TYPES].sort()).toEqual(
      [
        "image/gif",
        "image/jpeg",
        "image/png",
        "image/svg+xml",
        "image/webp",
      ].sort(),
    );

    for (const type of FORM_LOGO_IMAGE_TYPES) {
      expect(isFormBrandingImageType(type, FORM_LOGO_IMAGE)).toBe(true);
      // However the type was written.
      expect(
        isFormBrandingImageType(` ${type.toUpperCase()} `, FORM_LOGO_IMAGE),
      ).toBe(true);
    }

    // An ICO is a favicon's format, never a logo's.
    for (const refused of [MimeType.ico, ...NEVER_AN_IMAGE]) {
      expect([
        refused,
        isFormBrandingImageType(refused, FORM_LOGO_IMAGE),
      ]).toEqual([refused, false]);
    }
  });

  test("a favicon is any of those, or an ICO - the classic favicon format", () => {
    expect([...FORM_FAVICON_IMAGE_TYPES].sort()).toEqual(
      [...FORM_LOGO_IMAGE_TYPES, "image/x-icon"].sort(),
    );
    expect(MimeType.ico).toBe("image/x-icon");

    for (const type of FORM_FAVICON_IMAGE_TYPES) {
      expect(isFormBrandingImageType(type, FORM_FAVICON_IMAGE)).toBe(true);
      expect(
        isFormBrandingImageType(` ${type.toUpperCase()} `, FORM_FAVICON_IMAGE),
      ).toBe(true);
    }

    for (const refused of NEVER_AN_IMAGE) {
      expect([
        refused,
        isFormBrandingImageType(refused, FORM_FAVICON_IMAGE),
      ]).toEqual([refused, false]);
    }
  });

  test("a logo weighs 512 KB at most, a favicon 128 KB, and the alt text fits its column", () => {
    expect(FORM_LOGO_MAX_BYTES).toBe(512 * 1024);
    expect(FORM_FAVICON_MAX_BYTES).toBe(128 * 1024);
    expect(FORM_LOGO_ALT_TEXT_MAX_LENGTH).toBe(100);
  });

  test("names the two images and every column that holds them", () => {
    expect(FORM_BRANDING_IMAGES).toEqual([FORM_LOGO_IMAGE, FORM_FAVICON_IMAGE]);
    expect(FORM_LOGO_IMAGE).toEqual({
      kind: FormBrandingImageKind.Logo,
      relationColumn: "logoFile",
      idColumn: "logoFileId",
      name: "logo",
      types: FORM_LOGO_IMAGE_TYPES,
      maxBytes: FORM_LOGO_MAX_BYTES,
      typeMessage: FORM_LOGO_TYPE_MESSAGE,
      tooLargeMessage: FORM_LOGO_TOO_LARGE_MESSAGE,
      notFoundMessage: FORM_LOGO_NOT_FOUND_MESSAGE,
    });
    expect(FORM_FAVICON_IMAGE).toEqual({
      kind: FormBrandingImageKind.Favicon,
      relationColumn: "faviconFile",
      idColumn: "faviconFileId",
      name: "favicon",
      types: FORM_FAVICON_IMAGE_TYPES,
      maxBytes: FORM_FAVICON_MAX_BYTES,
      typeMessage: FORM_FAVICON_TYPE_MESSAGE,
      tooLargeMessage: FORM_FAVICON_TOO_LARGE_MESSAGE,
      notFoundMessage: FORM_FAVICON_NOT_FOUND_MESSAGE,
    });
    expect(FORM_BRANDING_COLUMNS).toEqual([
      "logoFile",
      "logoFileId",
      "logoAltText",
      "faviconFile",
      "faviconFileId",
    ]);
  });

  test("words each refusal as a whole sentence that names the image and its own limits", () => {
    expect(FORM_LOGO_TYPE_MESSAGE).toBe(
      "The logo must be a PNG, JPEG, GIF, WebP or SVG image.",
    );
    expect(FORM_LOGO_TOO_LARGE_MESSAGE).toBe(
      "The logo must be 512 KB or smaller.",
    );
    expect(FORM_LOGO_NOT_FOUND_MESSAGE).toBe(
      "The logo's file could not be found. Upload the logo again.",
    );
    expect(FORM_FAVICON_TYPE_MESSAGE).toBe(
      "The favicon must be a PNG, JPEG, GIF, WebP, SVG or ICO image.",
    );
    expect(FORM_FAVICON_TOO_LARGE_MESSAGE).toBe(
      "The favicon must be 128 KB or smaller.",
    );
    expect(FORM_FAVICON_NOT_FOUND_MESSAGE).toBe(
      "The favicon's file could not be found. Upload the favicon again.",
    );
  });

  test("each limit a message names is the one the rules hold the image to", () => {
    expect(FORM_LOGO_TOO_LARGE_MESSAGE).toContain(
      `${FORM_LOGO_MAX_BYTES / 1024} KB`,
    );
    expect(FORM_FAVICON_TOO_LARGE_MESSAGE).toContain(
      `${FORM_FAVICON_MAX_BYTES / 1024} KB`,
    );
  });
});

describe("getFileBytes - a stored file's bytes, however they arrived", () => {
  test("a Buffer, as Postgres hands it over", () => {
    expect(Array.from(getFileBytes(Buffer.from(PNG_BYTES))!)).toEqual(
      PNG_BYTES,
    );
  });

  test("a view into a larger buffer: only its own bytes", () => {
    const larger: Uint8Array = new Uint8Array([9, 9, ...PNG_BYTES, 9]);
    const view: Uint8Array = larger.subarray(2, 2 + PNG_BYTES.length);

    expect(Array.from(getFileBytes(view)!)).toEqual(PNG_BYTES);
  });

  test("an ArrayBuffer", () => {
    expect(Array.from(getFileBytes(new Uint8Array(PNG_BYTES).buffer)!)).toEqual(
      PNG_BYTES,
    );
  });

  test("the JSON a Buffer turns into, and the API's wrapper around it", () => {
    const json: unknown = JSON.parse(JSON.stringify(Buffer.from(PNG_BYTES)));

    expect(json).toEqual({ type: "Buffer", data: PNG_BYTES });
    expect(Array.from(getFileBytes(json)!)).toEqual(PNG_BYTES);
    expect(Array.from(getFileBytes({ _type: "Buffer", value: json })!)).toEqual(
      PNG_BYTES,
    );
    expect(Array.from(getFileBytes(PNG_BYTES)!)).toEqual(PNG_BYTES);
  });

  test("nothing else", () => {
    for (const value of [
      undefined,
      null,
      "",
      PNG_BASE64,
      42,
      {},
      { type: "Buffer" },
      { type: "Buffer", data: [1, 2, 300] },
      { type: "Buffer", data: ["a"] },
      { _type: "Buffer", value: "abc" },
      [1.5],
      [-1],
    ]) {
      expect([value, getFileBytes(value)]).toEqual([value, null]);
    }
  });
});

describe("encodeBase64", () => {
  test("with Buffer, as on the server", () => {
    expect(encodeBase64(Uint8Array.from(PNG_BYTES))).toBe(PNG_BASE64);
  });

  test("without Buffer, as in a browser, the same", () => {
    (globalThis as unknown as { Buffer: unknown }).Buffer = undefined;

    expect(encodeBase64(Uint8Array.from(PNG_BYTES))).toBe(PNG_BASE64);
  });

  test("without Buffer, an image larger than one slice comes out whole", () => {
    const bytes: Uint8Array = new Uint8Array(100_000);

    for (let index: number = 0; index < bytes.length; index++) {
      bytes[index] = index % 256;
    }

    const expected: string = originalBuffer.from(bytes).toString("base64");

    (globalThis as unknown as { Buffer: unknown }).Buffer = undefined;

    expect(encodeBase64(bytes)).toBe(expected);
  });
});

describe("getFormBrandingImageProblem - what a write may point a form at", () => {
  test.each(FORM_BRANDING_IMAGES)(
    "the $name: an image of an allowed type and size passes",
    (image: FormBrandingImageDefinition) => {
      for (const type of image.types) {
        expect(
          getFormBrandingImageProblem({
            image: image,
            file: { fileType: type, size: PNG_BYTES.length },
          }),
        ).toBeNull();
      }

      // One byte, and exactly the most it may weigh.
      for (const size of [1, image.maxBytes]) {
        expect(
          getFormBrandingImageProblem({
            image: image,
            file: { fileType: MimeType.png, size: size },
          }),
        ).toBeNull();
      }
    },
  );

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: a file that does not exist, or holds nothing, is not found",
    (image: FormBrandingImageDefinition) => {
      for (const file of [
        null,
        undefined,
        { fileType: MimeType.png },
        { fileType: MimeType.png, size: 0 },
        { fileType: MimeType.png, size: null },
        { fileType: MimeType.png, size: "12" },
        { fileType: MimeType.png, size: Number.NaN },
        { fileType: MimeType.png, size: Number.POSITIVE_INFINITY },
        { fileType: MimeType.png, size: -1 },
      ]) {
        expect([file, getFormBrandingImageProblem({ image, file })]).toEqual([
          file,
          image.notFoundMessage,
        ]);
      }
    },
  );

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: a document, a web page or an unknown type is refused",
    (image: FormBrandingImageDefinition) => {
      for (const fileType of NEVER_AN_IMAGE) {
        expect([
          fileType,
          getFormBrandingImageProblem({
            image,
            file: { fileType, size: PNG_BYTES.length },
          }),
        ]).toEqual([fileType, image.typeMessage]);
      }
    },
  );

  test("an ICO may be the favicon, never the logo", () => {
    expect(
      getFormBrandingImageProblem({
        image: FORM_FAVICON_IMAGE,
        file: { fileType: MimeType.ico, size: ICO_BYTES.length },
      }),
    ).toBeNull();
    expect(
      getFormBrandingImageProblem({
        image: FORM_LOGO_IMAGE,
        file: { fileType: MimeType.ico, size: ICO_BYTES.length },
      }),
    ).toBe(FORM_LOGO_TYPE_MESSAGE);
  });

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: one byte over its most is refused",
    (image: FormBrandingImageDefinition) => {
      expect(
        getFormBrandingImageProblem({
          image,
          file: { fileType: MimeType.png, size: image.maxBytes + 1 },
        }),
      ).toBe(image.tooLargeMessage);
    },
  );

  test("a file small enough for a logo can still be too large for a favicon", () => {
    const size: number = FORM_FAVICON_MAX_BYTES + 1;

    expect(size).toBeLessThan(FORM_LOGO_MAX_BYTES);
    expect(
      getFormBrandingImageProblem({
        image: FORM_LOGO_IMAGE,
        file: { fileType: MimeType.png, size },
      }),
    ).toBeNull();
    expect(
      getFormBrandingImageProblem({
        image: FORM_FAVICON_IMAGE,
        file: { fileType: MimeType.png, size },
      }),
    ).toBe(FORM_FAVICON_TOO_LARGE_MESSAGE);
  });
});

describe("getPublicFormImage / getPublicFormBranding - what the page is told", () => {
  test("an image as its type and its bytes, base64", () => {
    expect(getPublicFormImage(pngFile(), FORM_LOGO_IMAGE)).toEqual({
      type: "image/png",
      data: PNG_BASE64,
    });

    expect(
      getPublicFormImage(
        {
          file: Buffer.from(SVG_TEXT),
          fileType: " IMAGE/SVG+XML ",
        },
        FORM_LOGO_IMAGE,
      ),
    ).toEqual({
      type: "image/svg+xml",
      data: Buffer.from(SVG_TEXT).toString("base64"),
    });
  });

  test("an ICO as the favicon, never as the logo", () => {
    expect(getPublicFormImage(icoFile(), FORM_FAVICON_IMAGE)).toEqual({
      type: "image/x-icon",
      data: ICO_BASE64,
    });
    expect(getPublicFormImage(icoFile(), FORM_LOGO_IMAGE)).toBeUndefined();
  });

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: never an image the rules refuse, whatever a row holds",
    (image: FormBrandingImageDefinition) => {
      for (const file of [
        undefined,
        null,
        "image",
        [pngFile()],
        {
          file: Buffer.from("<script>alert(1)</script>"),
          fileType: "text/html",
        },
        { file: Buffer.from(PNG_BYTES), fileType: MimeType.pdf },
        { file: Buffer.alloc(0), fileType: MimeType.png },
        { file: "iVBORw0KGgo=", fileType: MimeType.png },
        { fileType: MimeType.png },
        {
          file: Buffer.alloc(image.maxBytes + 1),
          fileType: MimeType.png,
        },
      ]) {
        expect(getPublicFormImage(file, image)).toBeUndefined();
      }

      // Exactly the most it may weigh is told.
      expect(
        getPublicFormImage(
          { file: Buffer.alloc(image.maxBytes), fileType: MimeType.png },
          image,
        ),
      ).toBeDefined();
    },
  );

  test("a form without branding is told nothing more than before", () => {
    expect(getPublicFormBranding({})).toEqual({});
    expect(
      getPublicFormBranding({
        logoFile: null,
        logoAltText: null,
        faviconFile: null,
      }),
    ).toEqual({});
  });

  test("the logo, its alt text and the favicon, each when set", () => {
    const branding: PublicFormBranding = getPublicFormBranding({
      logoFile: pngFile(),
      logoAltText: "  Acme Inc.  ",
      faviconFile: {
        file: Buffer.from(SVG_TEXT),
        fileType: MimeType.svg,
      },
    });

    expect(branding).toEqual({
      logo: { type: "image/png", data: PNG_BASE64 },
      logoAltText: "Acme Inc.",
      favicon: {
        type: "image/svg+xml",
        data: Buffer.from(SVG_TEXT).toString("base64"),
      },
    });
  });

  test("the alt text goes only with a logo the page will draw", () => {
    expect(getPublicFormBranding({ logoAltText: "Acme Inc." })).toEqual({});
    expect(
      getPublicFormBranding({
        logoFile: { file: Buffer.from(PNG_BYTES), fileType: MimeType.pdf },
        logoAltText: "Acme Inc.",
      }),
    ).toEqual({});
    expect(
      getPublicFormBranding({ logoFile: icoFile(), logoAltText: "Acme Inc." }),
    ).toEqual({});
    expect(
      getPublicFormBranding({ logoFile: pngFile(), logoAltText: "   " }),
    ).toEqual({ logo: { type: "image/png", data: PNG_BASE64 } });
  });

  test("a favicon alone, an ICO one included", () => {
    expect(getPublicFormBranding({ faviconFile: pngFile() })).toEqual({
      favicon: { type: "image/png", data: PNG_BASE64 },
    });
    expect(getPublicFormBranding({ faviconFile: icoFile() })).toEqual({
      favicon: { type: "image/x-icon", data: ICO_BASE64 },
    });
  });

  test("a favicon larger than a favicon may be is not told, though a logo that size would be", () => {
    const file: { file: Buffer; fileType: string } = {
      file: Buffer.alloc(FORM_FAVICON_MAX_BYTES + 1),
      fileType: MimeType.png,
    };

    expect(getPublicFormBranding({ faviconFile: file })).toEqual({});
    expect(getPublicFormBranding({ logoFile: file }).logo).toBeDefined();
  });
});

describe("readFormLogoAltText", () => {
  test("trimmed, capped at the column's length, and nothing when empty", () => {
    expect(readFormLogoAltText("  Acme Inc.  ")).toBe("Acme Inc.");
    expect(readFormLogoAltText("x".repeat(150))).toBe(
      "x".repeat(FORM_LOGO_ALT_TEXT_MAX_LENGTH),
    );

    for (const value of ["", "   ", undefined, null, 7, {}]) {
      expect(readFormLogoAltText(value)).toBeUndefined();
    }
  });
});

describe("getBase64MaxLength", () => {
  test("the longest base64 a file of so many bytes takes", () => {
    for (const bytes of [1, 2, 3, 4, 5, 6, 100, FORM_FAVICON_MAX_BYTES]) {
      expect(getBase64MaxLength(bytes)).toBe(
        Buffer.alloc(bytes).toString("base64").length,
      );
    }
  });
});

describe("readPublicFormImage - what the page will draw of what it was handed", () => {
  test("an allowed type in real base64", () => {
    expect(
      readPublicFormImage(
        { type: "image/png", data: PNG_BASE64 },
        FORM_LOGO_IMAGE,
      ),
    ).toEqual({ type: "image/png", data: PNG_BASE64 });
    expect(
      readPublicFormImage(
        { type: "IMAGE/WEBP", data: "AAAA", extra: 1 },
        FORM_LOGO_IMAGE,
      ),
    ).toEqual({ type: "image/webp", data: "AAAA" });
  });

  test("an ICO as the favicon, never as the logo", () => {
    const told: unknown = { type: "image/x-icon", data: ICO_BASE64 };

    expect(readPublicFormImage(told, FORM_FAVICON_IMAGE)).toEqual({
      type: "image/x-icon",
      data: ICO_BASE64,
    });
    expect(readPublicFormImage(told, FORM_LOGO_IMAGE)).toBeUndefined();
  });

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: never a type that is not an image, or that a data: URL could turn into a page",
    (image: FormBrandingImageDefinition) => {
      for (const type of [
        "text/html",
        "image/svg+xml;charset=utf-8,<svg onload=alert(1)>",
        "application/pdf",
        "image/png;base64,AAAA",
        "",
        undefined,
      ]) {
        expect(
          readPublicFormImage({ type, data: PNG_BASE64 }, image),
        ).toBeUndefined();
      }
    },
  );

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: never data that is not base64 - nothing can leave the data: URL",
    (image: FormBrandingImageDefinition) => {
      for (const data of [
        "",
        "not base64!",
        'AAAA"onerror="alert(1)',
        "AAAA AAAA",
        "AAA",
        "AAAAA===",
        "A===",
        "data:image/png;base64,AAAA",
        42,
        undefined,
      ]) {
        expect(
          readPublicFormImage({ type: "image/png", data }, image),
        ).toBeUndefined();
      }
    },
  );

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: never more than the most it may weigh",
    (image: FormBrandingImageDefinition) => {
      const largest: string = "A".repeat(getBase64MaxLength(image.maxBytes));

      expect(
        readPublicFormImage({ type: "image/png", data: largest }, image),
      ).toBeDefined();
      expect(
        readPublicFormImage(
          { type: "image/png", data: `${largest}AAAA` },
          image,
        ),
      ).toBeUndefined();
    },
  );

  test("a logo's worth of base64 is too much for a favicon", () => {
    const logoSized: string = "A".repeat(
      getBase64MaxLength(FORM_LOGO_MAX_BYTES),
    );

    expect(
      readPublicFormImage(
        { type: "image/png", data: logoSized },
        FORM_LOGO_IMAGE,
      ),
    ).toBeDefined();
    expect(
      readPublicFormImage(
        { type: "image/png", data: logoSized },
        FORM_FAVICON_IMAGE,
      ),
    ).toBeUndefined();
  });

  test("nothing that is not an image at all", () => {
    for (const value of [undefined, null, "", "AAAA", [], [PNG_BASE64], 7]) {
      expect(readPublicFormImage(value, FORM_LOGO_IMAGE)).toBeUndefined();
      expect(readPublicFormImage(value, FORM_FAVICON_IMAGE)).toBeUndefined();
    }
  });

  test("round trips what the server tells", () => {
    const logo: PublicFormImage = getPublicFormImage(
      pngFile(),
      FORM_LOGO_IMAGE,
    )!;
    const favicon: PublicFormImage = getPublicFormImage(
      icoFile(),
      FORM_FAVICON_IMAGE,
    )!;

    expect(
      readPublicFormImage(JSON.parse(JSON.stringify(logo)), FORM_LOGO_IMAGE),
    ).toEqual(logo);
    expect(
      readPublicFormImage(
        JSON.parse(JSON.stringify(favicon)),
        FORM_FAVICON_IMAGE,
      ),
    ).toEqual(favicon);
  });

  test.each(FORM_BRANDING_IMAGES)(
    "the $name: the largest image the server tells is one the page draws",
    (image: FormBrandingImageDefinition) => {
      const told: PublicFormImage = getPublicFormImage(
        { file: Buffer.alloc(image.maxBytes, 7), fileType: MimeType.png },
        image,
      )!;

      expect(told).toBeDefined();
      expect(readPublicFormImage(told, image)).toEqual(told);
    },
  );
});

describe("getPublicFormImageUrl", () => {
  test("a data: URL of the image's own type", () => {
    expect(getPublicFormImageUrl({ type: "image/png", data: PNG_BASE64 })).toBe(
      `data:image/png;base64,${PNG_BASE64}`,
    );
    expect(
      getPublicFormImageUrl({ type: "image/x-icon", data: ICO_BASE64 }),
    ).toBe(`data:image/x-icon;base64,${ICO_BASE64}`);
  });
});

describe("buildPublicForm carries the branding the form was read with", () => {
  const build: (form: Record<string, unknown>) => BuiltPublicForm = (
    form: Record<string, unknown>,
  ): BuiltPublicForm => {
    return buildPublicForm({
      form: {
        name: "Report a Problem",
        fields: [],
        targetType: FormTargetType.Incident,
        ...form,
      },
      customFields: [],
      recordOptions: {},
      isCaptchaRequired: false,
    });
  };

  test("none when the form has none, or it was not read", () => {
    expect(Object.keys(build({}).form).sort()).toEqual(
      ["fields", "isCaptchaRequired", "name"].sort(),
    );
  });

  test("the logo, its alt text and the favicon", () => {
    const built: BuiltPublicForm = build({
      logoFile: pngFile(),
      logoAltText: "Acme Inc.",
      faviconFile: icoFile(),
    });

    expect(built.form.logo).toEqual({ type: "image/png", data: PNG_BASE64 });
    expect(built.form.logoAltText).toBe("Acme Inc.");
    expect(built.form.favicon).toEqual({
      type: "image/x-icon",
      data: ICO_BASE64,
    });
  });

  test("not an image the rules refuse", () => {
    const built: BuiltPublicForm = build({
      logoFile: { file: Buffer.from("<html>"), fileType: "text/html" },
      logoAltText: "Acme Inc.",
    });

    expect(built.form.logo).toBeUndefined();
    expect(built.form.logoAltText).toBeUndefined();
  });
});
