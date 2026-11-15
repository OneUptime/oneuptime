/*
 * One table of page addresses for both sides of the product analytics wire
 * (issue #8017): the browser recorder names the page an event happened on
 * (readProductAnalyticsPage), and the ingest and the reads run
 * toProductAnalyticsPage over whatever a recorder sent. Both must arrive at
 * the page's one spelling (UrlScrubber.normalizePathSpelling), the one
 * Session Replay stores and User Flows keys a page by, or one page is two.
 *
 * Each row is a browser location and what an older or cached recorder sent
 * for it: the path and the hash route as the browser had them, before the
 * recorder wrote one spelling. The recorder's suite (BrowserRecorder
 * Tests/ProductAnalytics.test.ts) reads `location` and the server's suites
 * (Common Tests/Types/Rum/ProductAnalyticsEvents.test.ts, and the ClickHouse
 * suite in App Tests/Telemetry/RumProductAnalyticsEventsClickhouse.test.ts)
 * read `sent`. Both expect `page`.
 *
 * Plain data, no imports: the recorder's suite runs without Node's types.
 */

export interface PageSpellingCase {
  // What the row is about.
  name: string;
  location: { pathname: string; hash: string };
  // What a recorder from before the one spelling sent for that location.
  sent: string;
  // The page both sides store.
  page: string;
}

const COMBINING_ACUTE: string = String.fromCharCode(0x301);

export const PAGE_SPELLINGS: ReadonlyArray<PageSpellingCase> = [
  {
    name: "the URL parser's own spelling",
    location: { pathname: "/caf%C3%A9", hash: "" },
    sent: "/caf%C3%A9",
    page: "/caf%C3%A9",
  },
  {
    name: "an escape in lower-case hex",
    location: { pathname: "/caf%c3%a9", hash: "" },
    sent: "/caf%c3%a9",
    page: "/caf%C3%A9",
  },
  {
    name: "an accent decomposed",
    location: { pathname: "/cafe%CC%81", hash: "" },
    sent: "/cafe%CC%81",
    page: "/caf%C3%A9",
  },
  {
    name: "an accent decomposed, in lower-case hex",
    location: { pathname: "/cafe%cc%81", hash: "" },
    sent: "/cafe%cc%81",
    page: "/caf%C3%A9",
  },
  {
    name: "the accent written as it reads",
    location: { pathname: "/café", hash: "" },
    sent: "/café",
    page: "/caf%C3%A9",
  },
  {
    name: "the accent written decomposed",
    location: { pathname: `/cafe${COMBINING_ACUTE}`, hash: "" },
    sent: `/cafe${COMBINING_ACUTE}`,
    page: "/caf%C3%A9",
  },
  {
    name: "a hash router's route",
    location: { pathname: "/", hash: "#/caf%c3%a9" },
    sent: "/caf%c3%a9",
    page: "/caf%C3%A9",
  },
  {
    name: "a hashbang route, with its query",
    location: { pathname: "/", hash: "#!/cafe%CC%81?tab=1" },
    sent: "/cafe%CC%81",
    page: "/caf%C3%A9",
  },
  {
    name: "a route under the page's own path",
    location: { pathname: "/shop/", hash: "#/men%c3%bc" },
    sent: "/shop/men%c3%bc",
    page: "/shop/men%C3%BC",
  },
  {
    name: "two escaped words in one path",
    location: { pathname: "/caf%c3%a9/men%C3%BC", hash: "" },
    sent: "/caf%c3%a9/men%C3%BC",
    page: "/caf%C3%A9/men%C3%BC",
  },
  {
    name: "a syllable written as its letters",
    location: { pathname: "/%E1%84%92%E1%85%A1%E1%86%AB", hash: "" },
    sent: "/%E1%84%92%E1%85%A1%E1%86%AB",
    page: "/%ED%95%9C",
  },
  {
    name: "an escaped slash, which is not a slash",
    location: { pathname: "/a%2fb", hash: "" },
    sent: "/a%2fb",
    page: "/a%2Fb",
  },
  {
    name: "a plain slash",
    location: { pathname: "/a/b", hash: "" },
    sent: "/a/b",
    page: "/a/b",
  },
  {
    name: "case outside an escape",
    location: { pathname: "/Cart", hash: "" },
    sent: "/Cart",
    page: "/Cart",
  },
  {
    name: "bytes that are not UTF-8",
    location: { pathname: "/%e9t%e9", hash: "" },
    sent: "/%e9t%e9",
    page: "/%E9t%E9",
  },
  {
    name: "a character NFC would write in ASCII (the Kelvin sign)",
    location: { pathname: "/%e2%84%aa", hash: "" },
    sent: "/%e2%84%aa",
    page: "/%E2%84%AA",
  },
  {
    name: "an anchor, which is no route",
    location: { pathname: "/pricing", hash: "#plans" },
    sent: "/pricing",
    page: "/pricing",
  },
];

/* One page, "/café", and every spelling of it a recorder sent. */
export const CAFE_PAGE: string = "/caf%C3%A9";

export const CAFE_SPELLINGS: ReadonlyArray<string> = Array.from(
  new Set(
    PAGE_SPELLINGS.filter((row: PageSpellingCase): boolean => {
      return row.page === CAFE_PAGE;
    }).map((row: PageSpellingCase): string => {
      return row.sent;
    }),
  ),
);
