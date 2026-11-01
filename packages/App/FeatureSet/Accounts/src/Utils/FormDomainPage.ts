import {
  FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT,
  FORM_CUSTOM_DOMAIN_PAGE_META_NAME,
} from "Common/Types/Form/FormCustomDomain";

/*
 * Whether this page is a form on its owner's own domain (FormDomain): the
 * server marked it so (App/FeatureSet/Frontend/FormDomainPage.ts), and only
 * the server can - it renders the mark into the page for a domain a form
 * has, and nowhere else.
 *
 * Such a page is the form and nothing else: the app draws the form alone,
 * at the domain's root, whatever the address (App.tsx), reads and submits it
 * on that domain (Utils/Form.ts), and keeps it light (Utils/AccountsTheme.ts).
 *
 * Read from the document every time it is asked: tests render both kinds of
 * page in one window.
 */
export const isFormDomainPage: (doc?: Document | undefined) => boolean = (
  doc?: Document | undefined,
): boolean => {
  const page: Document | undefined =
    doc || (typeof document === "undefined" ? undefined : document);

  if (!page) {
    return false;
  }

  const mark: Element | null = page.querySelector(
    `meta[name="${FORM_CUSTOM_DOMAIN_PAGE_META_NAME}"]`,
  );

  return (
    mark !== null &&
    mark.getAttribute("content") === FORM_CUSTOM_DOMAIN_PAGE_META_CONTENT
  );
};

/*
 * Where the page was opened - its scheme, host and port - which is where its
 * requests go on a form's domain. Empty outside a browser.
 */
export const getFormDomainPageOrigin: () => string = (): string => {
  if (typeof window === "undefined" || !window.location) {
    return "";
  }

  return window.location.origin || "";
};
