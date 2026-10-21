import {
  getPublicFormImageUrl,
  PublicFormImage,
} from "../../../Types/Form/FormBranding";

/*
 * The browser tab's icon while a form's public page is open: the form's own
 * favicon (its Branding) in place of OneUptime's, put back the way it was
 * when the page goes. Every icon link the page has - rel "icon" or
 * "shortcut icon", whatever their sizes - points at the form's image while
 * it is open, so no size the browser prefers still shows OneUptime's; the
 * Apple touch icon and the Safari pinned tab are for saved shortcuts, not
 * the tab, and are left alone. A page with no icon link gets one, removed
 * again on the way out.
 *
 * The image is the data: URL the form's own public read carried
 * (FormBranding), never an address of its own.
 */

// The links a browser draws the tab's icon from.
export const PUBLIC_FORM_ICON_LINK_SELECTOR: string = 'link[rel~="icon"]';

// A link this page added because the page had none.
export const PUBLIC_FORM_FAVICON_ATTRIBUTE: string = "data-form-favicon";

// What is changed on each icon link, and put back.
const SWAPPED_ATTRIBUTES: ReadonlyArray<string> = ["href", "type", "sizes"];

interface SavedIconLink {
  link: HTMLLinkElement;
  attributes: Array<{ name: string; value: string | null }>;
}

export type ShowPublicFormFaviconFunction = (data: {
  document: Document;
  favicon: PublicFormImage;
}) => () => void;

/**
 * Shows the form's favicon in the tab, and returns what puts the page's own
 * icons back.
 */
export const showPublicFormFavicon: ShowPublicFormFaviconFunction = (data: {
  document: Document;
  favicon: PublicFormImage;
}): (() => void) => {
  const url: string = getPublicFormImageUrl(data.favicon);

  const links: Array<HTMLLinkElement> = Array.from(
    data.document.querySelectorAll<HTMLLinkElement>(
      PUBLIC_FORM_ICON_LINK_SELECTOR,
    ),
  );

  if (links.length === 0) {
    const link: HTMLLinkElement = data.document.createElement("link");
    link.setAttribute("rel", "icon");
    link.setAttribute("type", data.favicon.type);
    link.setAttribute("href", url);
    link.setAttribute(PUBLIC_FORM_FAVICON_ATTRIBUTE, "true");
    data.document.head.appendChild(link);

    return (): void => {
      link.remove();
    };
  }

  const saved: Array<SavedIconLink> = links.map(
    (link: HTMLLinkElement): SavedIconLink => {
      return {
        link: link,
        attributes: SWAPPED_ATTRIBUTES.map(
          (name: string): { name: string; value: string | null } => {
            return { name: name, value: link.getAttribute(name) };
          },
        ),
      };
    },
  );

  for (const link of links) {
    link.setAttribute("href", url);
    // The page's own say "image/png": a browser skips an icon of a type it was told wrong.
    link.setAttribute("type", data.favicon.type);
    link.removeAttribute("sizes");
  }

  return (): void => {
    for (const entry of saved) {
      for (const attribute of entry.attributes) {
        if (attribute.value === null) {
          entry.link.removeAttribute(attribute.name);
        } else {
          entry.link.setAttribute(attribute.name, attribute.value);
        }
      }
    }
  };
};
