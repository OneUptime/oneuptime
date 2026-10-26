/*
 * The page an image file is shown on, for one its owner judges there: a
 * status page's logo, made for its light page, and its Dark Theme Logo, made
 * for its dark one. A detail card draws such an image on that page's own
 * background, in the dashboard's light theme and its dark one alike, so the
 * owner sees it as visitors will.
 *
 * Without it, an image sits on the card's own surface: white in the light
 * theme, slate in the dark one. A logo with light lettering vanished on the
 * white, and a logo with dark lettering on the slate.
 *
 * The colours are arbitrary values, which the dark theme's class remaps
 * (Theme.css) leave alone, as the form branding previews' are
 * (FormBrandingSection): the light page's grey (gray-50) and the dark
 * page's slate (slate-900, the status page's dark canvas), each with a rule
 * a step from it.
 *
 * React-free, so the card and its tests read the same classes.
 */
export enum DetailImageBackdrop {
  // A light page's background: a logo made for a light page.
  Light = "Light",
  // A dark page's background: a logo made for a dark page.
  Dark = "Dark",
}

export const DETAIL_IMAGE_BACKDROP_CLASS_NAMES: Record<
  DetailImageBackdrop,
  string
> = {
  [DetailImageBackdrop.Light]: "border-[#e5e7eb] bg-[#f9fafb]",
  [DetailImageBackdrop.Dark]: "border-[#1e293b] bg-[#0f172a]",
};

// Read by tests: which page an image is drawn on.
export const DETAIL_IMAGE_BACKDROP_ATTRIBUTE: string = "data-image-backdrop";
