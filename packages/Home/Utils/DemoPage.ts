/*
 * THE DEMO PAGE (/enterprise/demo), AND THE ADDRESSES THAT LEAD TO IT.
 *
 * The page is where people book a demo and talk to the team: the nav's
 * Enterprise > Request Demo, the site's "Request demo" and "Book a demo"
 * buttons, its "Talk to sales" and the support page's "Contact sales", the
 * Help menu of the Dashboard and of the Admin Dashboard, and the edition
 * label's "Talk to Sales" in the product all open it.
 *
 * oneuptime.com/demo, the address people type and say out loud, answered
 * 404, and so did every other way of writing it. Each address below now
 * moves permanently (301) to the page, keeping the query string a campaign
 * carries (Utils/Redirect.ts), so an ad or an email can name the short
 * address and still be measured. Routes.ts registers one route for each,
 * Utils/Sitemap.ts keeps them out of the sitemap, which names the page
 * alone, and Tests/DemoPage.test.ts holds the list and the routes together.
 */

export const DEMO_PAGE_PATH: string = "/enterprise/demo";

/*
 * The bare word; asking for a demo the four ways people write it - request,
 * book, schedule and get, with and without "a"; "contact sales", which the
 * page answers (the support page's "Contact sales" and the Pricing page's
 * "contact sales at ..." open it); and the page's place in the Enterprise
 * menu, by the menu's own word for it. Links the site writes always name
 * the page itself, never one of these (Tests/DemoPage.test.ts). The
 * deployed check (E2E Tests/Home/DemoAddresses.spec.ts) cannot import this
 * file, so it repeats the list, and Tests/DemoPage.test.ts holds the two
 * together.
 */
export const DEMO_SHORT_PATHS: ReadonlyArray<string> = [
  "/demo",
  "/request-demo",
  "/request-a-demo",
  "/book-demo",
  "/book-a-demo",
  "/schedule-demo",
  "/schedule-a-demo",
  "/get-demo",
  "/get-a-demo",
  "/contact-sales",
  "/enterprise/request-demo",
];
