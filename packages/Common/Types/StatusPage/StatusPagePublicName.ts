/*
 * A STATUS PAGE'S NAME, AS ITS VISITORS READ IT (#7467).
 *
 * A status page has two names: its name, the one field Create Status Page
 * and the guided setup ask for, and its Page Title (Branding > Title and
 * Search Engine Description, folded under More settings), which few people
 * ever set. The public page read the Page Title alone, so a new page - made
 * either way, with no Page Title - named itself nowhere: its tab read
 * "Status Page", its header was empty, and a customer landing on it could
 * not tell whose status it was, while the guided setup's preview of the
 * same page showed its name.
 *
 * A page's public name is its Page Title when it has one, else its name -
 * the rule its page's HTML title, its subscribers' emails and its
 * maintenance calendar already followed. The public page's header and tab,
 * the status page server's answers and the guided setup's preview all read
 * it here, so they say the same name. A page with a Page Title never sends
 * its name to a visitor: the name may be one the team uses among
 * themselves.
 */

export interface StatusPageNames {
  pageTitle?: string | null | undefined;
  name?: string | null | undefined;
}

export const getStatusPagePublicName: (
  statusPage: StatusPageNames,
) => string = (statusPage: StatusPageNames): string => {
  const pageTitle: string = (statusPage.pageTitle || "").trim();

  if (pageTitle) {
    return pageTitle;
  }

  return (statusPage.name || "").trim();
};

export default getStatusPagePublicName;
