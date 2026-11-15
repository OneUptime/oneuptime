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
 * read `sent`, and the location's whole address (addressOf), which a client
 * of the application's own sends. All expect `page`.
 *
 * A second table (PAGES_WITH_PERSONAL_DATA, issue #8197) holds addresses
 * that name a person or a secret, which both sides scrub alike, and a third
 * (PAGES_WITH_SECRETS, issue #8385) the tokens and twice-escaped addresses
 * the scrubber kept until then.
 *
 * Plain data, no imports: the recorder's suite runs without Node's types.
 */

export interface PageSpellingCase {
  // What the row is about.
  name: string;
  /*
   * The browser's location. The recorder reads the path and the fragment;
   * the query is there for the address a client of its own sends
   * (addressOf).
   */
  location: { pathname: string; hash: string; search?: string };
  // What a recorder from before the one spelling sent for that location.
  sent: string;
  // The page both sides store.
  page: string;
}

/*
 * The location's whole address, as a client of the application's own sends
 * it when it posts events with the ingestion key itself - the page's
 * location.href, query and fragment and all. The server files it on the
 * page the recorder names for that location.
 */
export function addressOf(row: PageSpellingCase): string {
  return `https://shop.example.com${row.location.pathname}${row.location.search || ""}${row.location.hash}`;
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

/*
 * #8197: pages whose address names a person or a secret. The recorder
 * scrubs them before it sends (readProductAnalyticsPage), as Session Replay
 * scrubs every address it keeps; `sent` is what a client that does not
 * scrub sends - a recorder from before, or the application's own code
 * posting with its ingestion key - and the server scrubs it the same way.
 * Both store `page`: every segment shaped like an identifier (an email, a
 * uuid, an object id, nine digits or more, a token of 32 or more letters,
 * digits, "_" and "-") is "[redacted]", escaped or not, in the path or in a
 * hash router's route, and the query and any other fragment are dropped.
 * What names no one is kept as it is.
 */
export const PAGES_WITH_PERSONAL_DATA: ReadonlyArray<PageSpellingCase> = [
  {
    name: "an email in the path",
    location: { pathname: "/users/someone@example.com/orders", hash: "" },
    sent: "/users/someone@example.com/orders",
    page: "/users/[redacted]/orders",
  },
  {
    name: "an escaped email",
    location: { pathname: "/users/someone%40example.com", hash: "" },
    sent: "/users/someone%40example.com",
    page: "/users/[redacted]",
  },
  {
    name: "an escaped email with a tag and capitals",
    location: { pathname: "/invite/First.Last+news%40Example.co.uk", hash: "" },
    sent: "/invite/First.Last+news%40Example.co.uk",
    page: "/invite/[redacted]",
  },
  {
    name: "an email beyond ASCII",
    location: { pathname: "/u/j%C3%B6rg@m%C3%BCller.de", hash: "" },
    sent: "/u/jörg@müller.de",
    page: "/u/[redacted]",
  },
  {
    name: "a uuid",
    location: {
      pathname: "/reset/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
      hash: "",
    },
    sent: "/reset/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
    page: "/reset/[redacted]",
  },
  {
    name: "a uuid in capitals, between two words",
    location: {
      pathname: "/orders/3F1A9C7E-5B2D-4801-96A3-C9E7B1D5028F/items",
      hash: "",
    },
    sent: "/orders/3F1A9C7E-5B2D-4801-96A3-C9E7B1D5028F/items",
    page: "/orders/[redacted]/items",
  },
  {
    name: "an object id",
    location: {
      pathname: "/projects/5f8d0d55b54764421b7156c9/settings",
      hash: "",
    },
    sent: "/projects/5f8d0d55b54764421b7156c9/settings",
    page: "/projects/[redacted]/settings",
  },
  {
    name: "a long run of digits (a card, a phone, an account)",
    location: { pathname: "/accounts/4111111111111111/statements", hash: "" },
    sent: "/accounts/4111111111111111/statements",
    page: "/accounts/[redacted]/statements",
  },
  {
    name: "an opaque token",
    location: {
      pathname: "/magic-link/Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
      hash: "",
    },
    sent: "/magic-link/Zx8_kQ2-vT9mL4pR7sW1yB6nC3dF5gH0jK",
    page: "/magic-link/[redacted]",
  },
  {
    name: "a token in the query",
    location: {
      pathname: "/reset-password",
      search:
        "?token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK&email=someone%40example.com",
      hash: "",
    },
    sent: "/reset-password?token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK&email=someone%40example.com",
    page: "/reset-password",
  },
  {
    name: "an email in a hash router's route",
    location: { pathname: "/", hash: "#/users/someone@example.com" },
    sent: "/users/someone@example.com",
    page: "/users/[redacted]",
  },
  {
    name: "a uuid and a token in a hashbang route under the page's path",
    location: {
      pathname: "/app/",
      hash: "#!/invite/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f?token=abc123",
    },
    sent: "/app/invite/3f1a9c7e-5b2d-4801-96a3-c9e7b1d5028f",
    page: "/app/invite/[redacted]",
  },
  {
    name: "an email in a route's query",
    location: { pathname: "/", hash: "#/search?email=someone%40example.com" },
    sent: "/search?email=someone%40example.com",
    page: "/search",
  },
  {
    name: "a fragment that is no route",
    location: {
      pathname: "/welcome",
      hash: "#access_token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK",
    },
    sent: "/welcome#access_token=Zx8kQ2vT9mL4pR7sW1yB6nC3dF5gH0jK",
    page: "/welcome",
  },
  {
    name: "a short numeric id, which names no one",
    location: { pathname: "/orders/42/items/12345678", hash: "" },
    sent: "/orders/42/items/12345678",
    page: "/orders/42/items/12345678",
  },
  {
    name: "a slug and a word in capitals",
    location: { pathname: "/blog/how-to-ship-on-friday/Comments", hash: "" },
    sent: "/blog/how-to-ship-on-friday/Comments",
    page: "/blog/how-to-ship-on-friday/Comments",
  },
  {
    name: "what is redacted already",
    location: { pathname: "/users/[redacted]/orders", hash: "" },
    sent: "/users/[redacted]/orders",
    page: "/users/[redacted]/orders",
  },
];

/*
 * #8385: secrets a page's path held that the scrubber kept until then, and
 * the shapes beside them it must still keep. A JSON Web Token's dots kept it
 * out of the token rule, and an address escaped twice
 * ("someone%2540example.com") read once is "someone%40example.com", which
 * has no "@". Both sides redact them now: the recorder before it sends
 * (readProductAnalyticsPage), the server over whatever was sent
 * (toProductAnalyticsPage), and Session Replay in every address it keeps
 * (UrlScrubber.scrubPath). A table of its own, beside
 * PAGES_WITH_PERSONAL_DATA, which RedactPersonalDataInProductAnalyticsPages
 * (#8197) reads with the rule it shipped with; ScrubProductAnalyticsAddresses
 * reads both.
 */
const JWT: string =
  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

export const PAGES_WITH_SECRETS: ReadonlyArray<PageSpellingCase> = [
  {
    name: "a signed JSON Web Token",
    location: { pathname: `/auth/callback/${JWT}`, hash: "" },
    sent: `/auth/callback/${JWT}`,
    page: "/auth/callback/[redacted]",
  },
  {
    name: "an unsigned JSON Web Token, its signature empty",
    location: {
      pathname: "/t/eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0./open",
      hash: "",
    },
    sent: "/t/eyJhbGciOiJub25lIn0.eyJzdWIiOiIxIn0./open",
    page: "/t/[redacted]/open",
  },
  {
    name: "an encrypted JSON Web Token, in five parts",
    location: {
      pathname:
        "/s/eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..T8xa6fPSdTEQd7Qv.lGzN6s5CeqZXyO8I8.XFBoMYUZodetZdvTiFvSkQ",
      hash: "",
    },
    sent: "/s/eyJhbGciOiJkaXIiLCJlbmMiOiJBMTI4R0NNIn0..T8xa6fPSdTEQd7Qv.lGzN6s5CeqZXyO8I8.XFBoMYUZodetZdvTiFvSkQ",
    page: "/s/[redacted]",
  },
  {
    name: "a JSON Web Token in a hash router's route",
    location: { pathname: "/", hash: `#/verify/${JWT}?next=%2F` },
    sent: `/verify/${JWT}`,
    page: "/verify/[redacted]",
  },
  {
    name: "a JSON Web Token in a hashbang route under the page's path",
    location: { pathname: "/app/", hash: `#!/session/${JWT}` },
    sent: `/app/session/${JWT}`,
    page: "/app/session/[redacted]",
  },
  {
    name: "an email escaped twice",
    location: { pathname: "/users/someone%2540example.com/orders", hash: "" },
    sent: "/users/someone%2540example.com/orders",
    page: "/users/[redacted]/orders",
  },
  {
    name: "an email with a tag and capitals, escaped twice",
    location: {
      pathname: "/invite/First.Last%252Bnews%2540Example.co.uk",
      hash: "",
    },
    sent: "/invite/First.Last%252Bnews%2540Example.co.uk",
    page: "/invite/[redacted]",
  },
  {
    name: "a long run of digits escaped twice",
    location: {
      pathname: "/accounts/%2534%2531%2531%2531%2531%2531%2531%2531%2531",
      hash: "",
    },
    sent: "/accounts/%2534%2531%2531%2531%2531%2531%2531%2531%2531",
    page: "/accounts/[redacted]",
  },
  {
    name: "an email escaped twice in a hash router's route",
    location: { pathname: "/", hash: "#/u/someone%2540example.com" },
    sent: "/u/someone%2540example.com",
    page: "/u/[redacted]",
  },
  // #8489: a token in standard base64, which the token rule took only in base64url.
  {
    name: "a token in standard base64, with its padding",
    location: {
      pathname: "/verify/dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw==",
      hash: "",
    },
    sent: "/verify/dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw==",
    page: "/verify/[redacted]",
  },
  {
    name: "a token in standard base64, with a plus",
    location: {
      pathname: "/reset/k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8",
      hash: "",
    },
    sent: "/reset/k3J+vT9mL4pR7sW1yB6nC3dF5gH0jKq2Zx8",
    page: "/reset/[redacted]",
  },
  {
    name: "a token in standard base64, escaped as a link escapes it",
    location: {
      pathname: "/confirm/k3J%2BvT9mL4pR7sW1yB6nC3dF5gH0jK%2Fq2Zx8%3D%3D/done",
      hash: "",
    },
    sent: "/confirm/k3J%2BvT9mL4pR7sW1yB6nC3dF5gH0jK%2Fq2Zx8%3D%3D/done",
    page: "/confirm/[redacted]/done",
  },
  {
    name: "a padded token in a hash router's route",
    location: {
      pathname: "/",
      hash: "#/magic/dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw=",
    },
    sent: "/magic/dGhpcyBpcyBhIHNlY3JldCB0b2tlbiBmb3IgdGVzdGluZw=",
    page: "/magic/[redacted]",
  },
  {
    name: "a word with a plus, and a filter with an equals sign, which name no one",
    location: { pathname: "/learn/c++/filter/size=large", hash: "" },
    sent: "/learn/c++/filter/size=large",
    page: "/learn/c++/filter/size=large",
  },
  {
    name: "a file name with dots, which names no one",
    location: { pathname: "/files/report-2026-11-15.pdf", hash: "" },
    sent: "/files/report-2026-11-15.pdf",
    page: "/files/report-2026-11-15.pdf",
  },
  {
    name: "a dotted version, which names no one",
    location: { pathname: "/docs/v14.2.0/release-notes.html", hash: "" },
    sent: "/docs/v14.2.0/release-notes.html",
    page: "/docs/v14.2.0/release-notes.html",
  },
  {
    name: "a word that starts as a token's header does, and is none",
    location: { pathname: "/eyJ/eyJsb2.png", hash: "" },
    sent: "/eyJ/eyJsb2.png",
    page: "/eyJ/eyJsb2.png",
  },
  {
    name: "an escaped percent sign, escaped twice, which names no one",
    location: { pathname: "/sale/50%2525-off", hash: "" },
    sent: "/sale/50%2525-off",
    page: "/sale/50%2525-off",
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
