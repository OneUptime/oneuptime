/*
 * The words of a public dashboard's two error pages, and what each says to
 * do next (#9132). Each said what was wrong in English on every page, and
 * nothing else: no one to ask, nothing to press. They are keys of the
 * public dashboard's locales now, so a visitor reads them in their browser's
 * language, and each ends in a way forward.
 *
 * Neither page knows who owns the dashboard - it shows nothing of the
 * dashboard - so it names who can help by what the visitor knows of them:
 * the person who shared the link, the dashboard's owner.
 *
 * The header's Show more and Show less, under a long description, are
 * here too: the public dashboard's own words, beside the error pages'.
 *
 * React-free, so the pages and the tests read these exact strings.
 */

// A dashboard that is not here: missing, archived, or shared only with its project.
export const NOT_FOUND_COPY: {
  title: string;
  description: string;
  nextStep: string;
} = {
  title: "Dashboard Not Found",
  description: "This dashboard does not exist, or it is no longer shared.",
  nextStep:
    "Check the address, or ask the person who shared it with you for a new link.",
};

// A dashboard whose IP allowlist does not let this visitor in.
export const FORBIDDEN_COPY: {
  title: string;
  description: string;
  nextStep: string;
  tryAgain: string;
} = {
  title: "Access Denied",
  description:
    "This dashboard opens only from the IP addresses its owner allows, and yours is not one of them.",
  nextStep:
    "Ask the dashboard's owner for access, or open it from a network they allow.",
  // The error screens' own words for it (ErrorBoundary): one translation.
  tryAgain: "Try again",
};

// A dashboard's description in its header, clamped to two lines until opened.
export const DESCRIPTION_COPY: { showMore: string; showLess: string } = {
  showMore: "Show more",
  showLess: "Show less",
};

export const ERROR_PAGE_TITLE_TEST_ID: string = "public-dashboard-error-title";
export const ERROR_PAGE_DESCRIPTION_TEST_ID: string =
  "public-dashboard-error-description";
export const ERROR_PAGE_NEXT_STEP_TEST_ID: string =
  "public-dashboard-error-next-step";
export const ERROR_PAGE_TRY_AGAIN_TEST_ID: string =
  "public-dashboard-error-try-again";
export const DESCRIPTION_TEST_ID: string = "public-dashboard-description";
export const DESCRIPTION_TOGGLE_TEST_ID: string =
  "public-dashboard-description-toggle";
