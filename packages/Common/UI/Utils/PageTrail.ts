import Link from "../../Types/Link";
import { getCrumbTitle } from "../Components/Page/RecordNameInTrail";

/*
 * THE TRAIL OF THE PAGE ON SCREEN, FOR WHAT NAMES THE PAGE FROM OUTSIDE IT
 * (issue #8893).
 *
 * Give Feedback said it was sent with "the page you are on
 * (/dashboard/:projectId/slos)": the route, which is what is sent - no
 * project, no record, no id - but reads as gibberish to a person. The page
 * already names itself in words: its breadcrumbs ("Project > SLOs"). Page
 * publishes its trail here as it draws it, and Give Feedback names the page
 * by it ("SLOs") while it still sends the route.
 *
 * A trail is published with the address it was drawn at, and read only
 * while that is still the address, so a page that has gone is never named.
 */

interface PublishedTrail {
  pathname: string;
  links: Array<Link>;
}

let published: PublishedTrail | null = null;

// The crumb every Dashboard trail starts with, which says nothing of the page.
const PROJECT_CRUMB: string = "Project";

const PATH_SEPARATOR: string = " › ";

const getCurrentPathname: () => string = (): string => {
  try {
    return window.location.pathname;
  } catch {
    return "";
  }
};

// Page's trail, as drawn at the address it is drawn at; none clears it.
export const publishPageTrail: (links: Array<Link> | undefined) => void = (
  links: Array<Link> | undefined,
): void => {
  published =
    links && links.length > 0
      ? { pathname: getCurrentPathname(), links: [...links] }
      : null;
};

// The trail of the page on screen, or null when the page drew none.
export const getPageTrail: () => Array<Link> | null =
  (): Array<Link> | null => {
    if (!published || published.pathname !== getCurrentPathname()) {
      return null;
    }

    return published.links;
  };

/*
 * The page's name in words, from its trail: its crumbs' titles in the
 * reader's language (getCrumbTitle), without the project it starts with
 * and without a record's name - the page, never what is on it, so nothing
 * that names a record is said to be sent: "Monitors › View Monitor ›
 * Criteria". Null for a trail that names no page.
 */
export const getPageTrailName: (
  links: Array<Link> | null | undefined,
  translateString: (value: string | undefined) => string | undefined,
) => string | null = (
  links: Array<Link> | null | undefined,
  translateString: (value: string | undefined) => string | undefined,
): string | null => {
  if (!links || links.length === 0) {
    return null;
  }

  const titles: Array<string> = links
    .filter((link: Link, index: number): boolean => {
      return !(index === 0 && link.title === PROJECT_CRUMB);
    })
    .filter((link: Link): boolean => {
      return !link.isRecordName;
    })
    .map((link: Link): string => {
      return getCrumbTitle(link, translateString).trim();
    })
    .filter((title: string): boolean => {
      return title.length > 0;
    });

  return titles.length > 0 ? titles.join(PATH_SEPARATOR) : null;
};
