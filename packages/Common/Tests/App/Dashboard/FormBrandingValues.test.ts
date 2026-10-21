import FormsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/FormsCopy";
import {
  clearLogoAltTextWithoutLogo,
  FORM_BRANDING_SELECT,
  FORM_FAVICON_UPLOAD,
  FORM_LOGO_UPLOAD,
  FormBrandingValues,
  getFormBrandingItems,
  getFormBrandingPreview,
  getFormBrandingSummary,
  getFormBrandingUpload,
  readFormBrandingValues,
} from "../../../../App/FeatureSet/Dashboard/src/Components/FormBuilder/Branding/FormBrandingValues";
import File from "../../../Models/DatabaseModels/File";
import Form from "../../../Models/DatabaseModels/Form";
import MimeType from "../../../Types/File/MimeType";
import {
  FORM_FAVICON_IMAGE,
  FORM_FAVICON_IMAGE_TYPES,
  FORM_FAVICON_MAX_BYTES,
  FORM_LOGO_IMAGE,
  FORM_LOGO_IMAGE_TYPES,
  FORM_LOGO_MAX_BYTES,
  PublicFormBranding,
} from "../../../Types/Form/FormBranding";
import ObjectID from "../../../Types/ObjectID";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import { describe, expect, test } from "@jest/globals";

/*
 * What the Build page's Branding section reads and says about a form's
 * branding, apart from drawing it: the columns it reads, the image types it
 * offers to upload, and - folded - which of the logo and the favicon are the
 * form's own and what the OneUptime defaults do meanwhile. It draws them by
 * the public page's own rules, so an image the page would not draw is shown
 * as the OneUptime one the page falls back to.
 */

const PNG: Buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);

function image(fileType: string, bytes: Buffer = PNG): File {
  const file: File = new File();
  file._id = "f1000000-0000-4000-8000-000000000001";
  file.name = "logo.png";
  file.fileType = fileType as MimeType;
  file.file = bytes;
  return file;
}

function itemsOf(values: FormBrandingValues): Array<string> {
  return getFormBrandingItems(getFormBrandingPreview(values)).map(
    (item: FoldedSectionItem): string => {
      return `${item.title}${item.isSet ? " (set)" : ""}`;
    },
  );
}

describe("what the section reads", () => {
  test("the alt text, and each image's id, name, type and bytes", () => {
    expect(FORM_BRANDING_SELECT).toEqual({
      logoAltText: true,
      logoFile: { _id: true, file: true, fileType: true, name: true },
      faviconFile: { _id: true, file: true, fileType: true, name: true },
    });
  });

  test("offers to upload exactly the image types and size the server takes, per image", () => {
    expect(FORM_LOGO_UPLOAD).toEqual({
      fileTypes: [...FORM_LOGO_IMAGE_TYPES],
      maxFileSizeInBytes: FORM_LOGO_MAX_BYTES,
    });
    expect(FORM_FAVICON_UPLOAD).toEqual({
      fileTypes: [...FORM_FAVICON_IMAGE_TYPES],
      maxFileSizeInBytes: FORM_FAVICON_MAX_BYTES,
    });
    expect(getFormBrandingUpload(FORM_LOGO_IMAGE)).toEqual(FORM_LOGO_UPLOAD);
    expect(getFormBrandingUpload(FORM_FAVICON_IMAGE)).toEqual(
      FORM_FAVICON_UPLOAD,
    );

    // A logo of 512 KB, a favicon of 128 KB - and only the favicon an ICO.
    expect(FORM_LOGO_UPLOAD.maxFileSizeInBytes).toBe(512 * 1024);
    expect(FORM_FAVICON_UPLOAD.maxFileSizeInBytes).toBe(128 * 1024);
    expect(FORM_LOGO_UPLOAD.fileTypes).not.toContain(MimeType.ico);
    expect(FORM_FAVICON_UPLOAD.fileTypes).toContain(MimeType.ico);
  });

  test("reads a form's branding, or none", () => {
    const logo: File = image(MimeType.png);
    const form: Form = new Form();
    form.logoFile = logo;
    form.logoAltText = "Acme Inc.";

    expect(readFormBrandingValues(form)).toEqual({
      logoFile: logo,
      logoAltText: "Acme Inc.",
      faviconFile: null,
    });
    expect(readFormBrandingValues(null)).toEqual({
      logoFile: null,
      logoAltText: null,
      faviconFile: null,
    });
  });
});

describe("drawn by the public page's rules", () => {
  test("an image the page would draw, base64", () => {
    const preview: PublicFormBranding = getFormBrandingPreview({
      logoFile: image(MimeType.png),
      logoAltText: "Acme Inc.",
      faviconFile: image(MimeType.svg),
    });

    expect(preview).toEqual({
      logo: { type: "image/png", data: PNG.toString("base64") },
      logoAltText: "Acme Inc.",
      favicon: { type: "image/svg+xml", data: PNG.toString("base64") },
    });
  });

  test("an image it would not draw is the OneUptime one it falls back to", () => {
    expect(
      getFormBrandingPreview({
        logoFile: image(MimeType.pdf),
        logoAltText: "Acme Inc.",
        faviconFile: image(
          MimeType.png,
          Buffer.alloc(FORM_FAVICON_MAX_BYTES + 1),
        ),
      }),
    ).toEqual({});
    expect(
      getFormBrandingPreview({
        logoFile: image(MimeType.png, Buffer.alloc(FORM_LOGO_MAX_BYTES + 1)),
      }),
    ).toEqual({});
  });

  test("an ICO is drawn as the favicon, never as the logo", () => {
    expect(
      getFormBrandingPreview({
        logoFile: image(MimeType.ico),
        logoAltText: "Acme Inc.",
        faviconFile: image(MimeType.ico),
      }),
    ).toEqual({
      favicon: { type: "image/x-icon", data: PNG.toString("base64") },
    });
  });
});

describe("saving: what a logo says goes with the logo", () => {
  function formWith(data: Partial<Form>): Form {
    const form: Form = new Form();
    form.logoAltText = "Acme Inc.";
    Object.assign(form, data);
    return form;
  }

  test("keeps the alt text while the form has a logo, either spelling", () => {
    const withRelation: Form = formWith({ logoFile: image(MimeType.png) });
    const withId: Form = formWith({
      logoFileId: new ObjectID("f1000000-0000-4000-8000-000000000001"),
    });

    expect(clearLogoAltTextWithoutLogo(withRelation).logoAltText).toBe(
      "Acme Inc.",
    );
    expect(clearLogoAltTextWithoutLogo(withId).logoAltText).toBe("Acme Inc.");
  });

  test("clears it - null, so the save clears the column - once the logo is gone", () => {
    for (const cleared of [
      formWith({}),
      formWith({ logoFile: null as unknown as File }),
      formWith({
        logoFile: undefined,
        logoFileId: undefined,
      } as unknown as Partial<Form>),
    ]) {
      const saved: Form = clearLogoAltTextWithoutLogo(cleared);

      expect(saved).toBe(cleared);
      expect(Object.prototype.hasOwnProperty.call(saved, "logoAltText")).toBe(
        true,
      );
      expect(saved.logoAltText).toBeNull();
    }
  });

  test("leaves the favicon alone", () => {
    const favicon: File = image(MimeType.ico);
    const saved: Form = clearLogoAltTextWithoutLogo(
      formWith({ faviconFile: favicon }),
    );

    expect(saved.faviconFile).toBe(favicon);
    expect(saved.logoAltText).toBeNull();
  });
});

describe("folded, what the section says", () => {
  test("lists the logo and the favicon, the form's own ones as set", () => {
    expect(itemsOf({})).toEqual(["Logo", "Favicon"]);
    expect(itemsOf({ logoFile: image(MimeType.png) })).toEqual([
      "Logo (set)",
      "Favicon",
    ]);
    expect(itemsOf({ faviconFile: image(MimeType.png) })).toEqual([
      "Logo",
      "Favicon (set)",
    ]);
    expect(
      itemsOf({
        logoFile: image(MimeType.png),
        faviconFile: image(MimeType.png),
      }),
    ).toEqual(["Logo (set)", "Favicon (set)"]);
  });

  test("says what the OneUptime defaults do, while they are in force", () => {
    const summaryOf: (values: FormBrandingValues) => string | undefined = (
      values: FormBrandingValues,
    ): string | undefined => {
      return getFormBrandingSummary(getFormBrandingPreview(values));
    };

    expect(summaryOf({})).toBe(FormsCopy.brandingSummaryDefault);
    expect(summaryOf({ faviconFile: image(MimeType.png) })).toBe(
      FormsCopy.brandingSummaryDefaultLogo,
    );
    expect(summaryOf({ logoFile: image(MimeType.png) })).toBe(
      FormsCopy.brandingSummaryDefaultFavicon,
    );
    expect(
      summaryOf({
        logoFile: image(MimeType.png),
        faviconFile: image(MimeType.png),
      }),
    ).toBeUndefined();
  });

  test("the sentences name the OneUptime defaults", () => {
    expect(FormsCopy.brandingSummaryDefault).toBe(
      "The form shows the OneUptime logo and favicon until you upload your own.",
    );
    expect(FormsCopy.brandingSummaryDefaultLogo).toBe(
      "The form shows the OneUptime logo until you upload yours.",
    );
    expect(FormsCopy.brandingSummaryDefaultFavicon).toBe(
      "The form shows the OneUptime favicon until you upload yours.",
    );
  });
});
