import { BASE_URL } from "../../Config";
import { APIResponse, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";

/*
 * The sensitive-URL-token bootstrap, asserted on the page the ingress actually
 * serves.
 *
 * Password reset and email verification links carry a single-use bearer token
 * in the URL path, and every analytics tag on the page reports the page URL as
 * a matter of course. Common/Server/Views/Partials/SensitiveUrlToken.ejs closes
 * that by rewriting the path before the Google Tag Manager container starts,
 * and by refusing to start the container at all when the rewrite did not take.
 *
 * Common/Tests/App/SensitiveUrlTokenBootstrap.test.ts already pins the
 * partial's behaviour and its load order by rendering the template in-process.
 * What that cannot see is the serving path: the partial reaches these pages
 * through an ejs `include`, resolved at request time against a view directory
 * inside the container. An image built without Common/Server/Views copied in,
 * a changed view root, or an include path that no longer resolves all produce
 * the same failure — ejs throws, or renders the page without the bootstrap —
 * and every in-process suite stays green because on a developer's checkout the
 * relative path is right there on disk.
 *
 * So this asserts the one thing only a served response can: the HTML a browser
 * receives from the deployed stack carries the no-referrer tag and the
 * bootstrap, and carries them ahead of the first external script. Both routes
 * are gated to "serving" by the deploy's readiness check
 * (Tests/Scripts/status-check.sh) before E2E runs, so a failure here is a real
 * regression rather than a warm-up race.
 */

const REFERRER_META: string = '<meta name="referrer" content="no-referrer" />';

// The partial's storage key — present only if the partial itself rendered.
const BOOTSTRAP_MARKER: string = "oneuptime-sensitive-url-token";

/*
 * The flag the bootstrap sets when it could NOT clean the address bar, and
 * which each page's Google Tag Manager snippet checks before starting the
 * container. It is the fail-closed half; a page that shipped the bootstrap but
 * lost this guard leaks exactly as before whenever the rewrite does not take.
 */
const FAIL_CLOSED_FLAG: string = "__ONEUPTIME_SENSITIVE_URL_TOKEN_PENDING__";

interface ServedPage {
  route: string;
  // The first external script on that page; the bootstrap must precede it.
  firstExternalScript: string;
}

const PAGES: Array<ServedPage> = [
  {
    route: "/accounts",
    firstExternalScript: '<script src="/accounts/env.js">',
  },
  {
    route: "/status-page",
    firstExternalScript: '<script src="/status-page/env.js">',
  },
];

test.describe("the sensitive-URL-token bootstrap survives to the served page", () => {
  for (const servedPage of PAGES) {
    test(`${servedPage.route} ships the bootstrap ahead of its first external script`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(servedPage.route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);

      expect(response.status()).toBeGreaterThanOrEqual(200);
      expect(response.status()).toBeLessThan(300);

      /*
       * Collapse whitespace before matching. The assertions below are about
       * which markup is present and in what order, and neither depends on how
       * the template happens to indent — but an exact-substring match would.
       */
      const html: string = (await response.text()).replace(/\s+/g, " ");

      /*
       * An ejs include that failed to resolve renders the error page, not the
       * app shell. Checking for the document first means such a failure reports
       * as "no HTML document" rather than as a confusing missing-meta-tag.
       */
      expect(html.toLowerCase()).toMatch(/<!doctype html|<html/);

      expect(
        html,
        `expected ${servedPage.route} to carry ${REFERRER_META} from the shared partial`,
      ).toContain(REFERRER_META);

      const bootstrap: number = html.indexOf(BOOTSTRAP_MARKER);
      const firstExternalScript: number = html.indexOf(
        servedPage.firstExternalScript,
      );

      expect(
        bootstrap,
        `expected ${servedPage.route} to include the sensitive-URL-token bootstrap`,
      ).toBeGreaterThan(-1);

      expect(
        firstExternalScript,
        `expected ${servedPage.route} to load ${servedPage.firstExternalScript}`,
      ).toBeGreaterThan(-1);

      /*
       * The whole point of the partial: a tag that loads before the bootstrap
       * runs is a tag that sees the token.
       */
      expect(
        firstExternalScript,
        `expected the bootstrap to run before ${servedPage.firstExternalScript}`,
      ).toBeGreaterThan(bootstrap);
    });

    test(`${servedPage.route} keeps its fail-closed analytics guard`, async ({
      page,
    }: {
      page: Page;
    }) => {
      page.setDefaultNavigationTimeout(120000); // 2 minutes

      const endpoint: string = URL.fromString(BASE_URL.toString())
        .addRoute(servedPage.route)
        .toString();

      const response: APIResponse = await page.request.get(endpoint);
      const html: string = (await response.text()).replace(/\s+/g, " ");

      /*
       * Asserted on every deployment, including those that ship with Google Tag
       * Manager switched off: the flag is set by the bootstrap unconditionally,
       * so its absence means the bootstrap itself is gone rather than that the
       * container is disabled.
       */
      expect(
        html,
        `expected ${servedPage.route} to set ${FAIL_CLOSED_FLAG} when the address bar could not be cleaned`,
      ).toContain(FAIL_CLOSED_FLAG);
    });
  }
});
