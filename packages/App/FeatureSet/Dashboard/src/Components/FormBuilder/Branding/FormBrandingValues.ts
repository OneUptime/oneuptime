import FormsCopy from "../FormsCopy";
import File from "Common/Models/DatabaseModels/File";
import Form from "Common/Models/DatabaseModels/Form";
import Select from "Common/Types/BaseDatabase/Select";
import Dictionary from "Common/Types/Dictionary";
import MimeType from "Common/Types/File/MimeType";
import {
  FORM_FAVICON_IMAGE,
  FORM_LOGO_IMAGE,
  FormBrandingImageDefinition,
  getPublicFormBranding,
  PublicFormBranding,
} from "Common/Types/Form/FormBranding";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";

/*
 * What the Build page's Branding section knows about a form - its logo, the
 * logo's alt text and its favicon - and what it says about them, kept free
 * of React so its rules can be tested on their own.
 *
 * The section draws the images exactly as the public page will
 * (getPublicFormBranding, the same rules the server sends them by): an image
 * the page would not draw - too large, of a type it does not take - is
 * shown as the OneUptime one it would fall back to.
 */

export interface FormBrandingValues {
  // The Files as the API returns them, bytes included.
  logoFile?: File | null | undefined;
  logoAltText?: string | null | undefined;
  faviconFile?: File | null | undefined;
}

// What to read of a form to draw its Branding section and its preview.
export const FORM_BRANDING_SELECT: Select<Form> = {
  logoAltText: true,
  logoFile: {
    _id: true,
    file: true,
    fileType: true,
    name: true,
  },
  faviconFile: {
    _id: true,
    file: true,
    fileType: true,
    name: true,
  },
};

/*
 * What the section's upload for one of the images offers: the types the
 * server takes for it, and the most it may weigh, so a larger file is
 * refused before it is uploaded.
 */
export interface FormBrandingUpload {
  fileTypes: Array<MimeType>;
  maxFileSizeInBytes: number;
}

export type GetFormBrandingUploadFunction = (
  image: FormBrandingImageDefinition,
) => FormBrandingUpload;

export const getFormBrandingUpload: GetFormBrandingUploadFunction = (
  image: FormBrandingImageDefinition,
): FormBrandingUpload => {
  return {
    fileTypes: image.types.map((type: string): MimeType => {
      return type as MimeType;
    }),
    maxFileSizeInBytes: image.maxBytes,
  };
};

export const FORM_LOGO_UPLOAD: FormBrandingUpload =
  getFormBrandingUpload(FORM_LOGO_IMAGE);

export const FORM_FAVICON_UPLOAD: FormBrandingUpload =
  getFormBrandingUpload(FORM_FAVICON_IMAGE);

export type ReadFormBrandingValuesFunction = (
  form: Form | null | undefined,
) => FormBrandingValues;

export const readFormBrandingValues: ReadFormBrandingValuesFunction = (
  form: Form | null | undefined,
): FormBrandingValues => {
  return {
    logoFile: form?.logoFile || null,
    logoAltText: form?.logoAltText || null,
    faviconFile: form?.faviconFile || null,
  };
};

export type ClearLogoAltTextWithoutLogoFunction = (form: Form) => Form;

/*
 * What a logo says goes with the logo: a Branding save that leaves the form
 * without one clears its alt text too, so a later logo never inherits words
 * written for another one, unseen (the dialog asks for alt text only once
 * there is a logo).
 */
export const clearLogoAltTextWithoutLogo: ClearLogoAltTextWithoutLogoFunction =
  (form: Form): Form => {
    if (!form.logoFile && !form.logoFileId) {
      (form as unknown as Dictionary<unknown>)["logoAltText"] = null;
    }

    return form;
  };

export type GetFormBrandingPreviewFunction = (
  values: FormBrandingValues,
) => PublicFormBranding;

// The branding the public page would be handed: what the section draws.
export const getFormBrandingPreview: GetFormBrandingPreviewFunction = (
  values: FormBrandingValues,
): PublicFormBranding => {
  return getPublicFormBranding({
    logoFile: values.logoFile,
    logoAltText: values.logoAltText,
    faviconFile: values.faviconFile,
  });
};

export type GetFormBrandingItemsFunction = (
  preview: PublicFormBranding,
) => Array<FoldedSectionItem>;

/*
 * Folded, the section lists what it holds - "Logo · Favicon" - with the ones
 * the form has of its own drawn as set.
 */
export const getFormBrandingItems: GetFormBrandingItemsFunction = (
  preview: PublicFormBranding,
): Array<FoldedSectionItem> => {
  return [
    foldedSectionItem("Logo", {
      key: "logo",
      isSet: Boolean(preview.logo),
    }),
    foldedSectionItem("Favicon", {
      key: "favicon",
      isSet: Boolean(preview.favicon),
    }),
  ];
};

export type GetFormBrandingSummaryFunction = (
  preview: PublicFormBranding,
) => string | undefined;

/*
 * Folded, the section also says what its defaults do - the OneUptime logo
 * and favicon - for as long as they are in force. Nothing once both are the
 * form's own: the set items say so.
 */
export const getFormBrandingSummary: GetFormBrandingSummaryFunction = (
  preview: PublicFormBranding,
): string | undefined => {
  if (!preview.logo && !preview.favicon) {
    return FormsCopy.brandingSummaryDefault;
  }

  if (!preview.logo) {
    return FormsCopy.brandingSummaryDefaultLogo;
  }

  if (!preview.favicon) {
    return FormsCopy.brandingSummaryDefaultFavicon;
  }

  return undefined;
};
