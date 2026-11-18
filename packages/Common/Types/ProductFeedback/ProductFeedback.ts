import { AskAiSourceCount } from "../AI/AskAiRatings";
import { JSONObject, JSONValue } from "../JSON";

/*
 * ASKING PEOPLE (issue #6832): how a person tells OneUptime "this was
 * hard", and the rules for when OneUptime asks.
 *
 * Four ways in, each a kind of answer:
 *
 *   - setup_flow   "How easy was that?" at the end of a guided setup
 *                  (GuidedSetupFrame), one click on 1 to 5, then an optional
 *                  "What got in the way?". The setup's key is the topic.
 *   - general      "Give feedback" in Help, on every page: what the person
 *                  wants to tell the team. What it is about - something
 *                  broken, confusing, an idea - is the topic
 *                  (GiveFeedbackCategory).
 *   - explanation  "Was this clear?" under How OneUptime works and a term's
 *                  definition: thumbs up or down. The explanation is the
 *                  topic (`how_oneuptime_works`, `term.criteria`).
 *   - check_in     "Is OneUptime set up the way you wanted?", once, on Home,
 *                  for the project's creator in its first weeks.
 *
 * And one the docs give, not the Dashboard:
 *
 *   - docs_page    "Was this page helpful?" at the foot of a docs page, kept
 *                  only where a master admin switched keeping them on
 *                  (GlobalConfig.keepDocsFeedback, #7209): yes or no, and
 *                  for a no what went wrong (DocsFeedbackReason). The docs
 *                  page (`monitor/website-monitor`) is the topic. Posted by
 *                  the docs server (App/FeatureSet/Docs), never by the
 *                  Dashboard: readProductFeedbackSubmission refuses it.
 *
 * HOW LONG ANSWERS ARE KEPT (#7366)
 *
 *   PRODUCT_FEEDBACK_RETENTION_IN_DAYS after they were given, then the
 *   daily purge deletes them (ProductFeedbackService's window, read by
 *   Workers' HardDelete:HardDeleteOlderItemsInDatabase). A master admin
 *   may delete one sooner, from Admin Dashboard > Feedback.
 *
 * WHERE ANSWERS GO
 *
 *   Into this server's own database (Models/DatabaseModels/ProductFeedback),
 *   read by the server's master admins in the Admin Dashboard (Feedback).
 *   On a self-hosted server nothing leaves the server; the form offers a
 *   pre-filled GitHub issue the person reads before sending, or not. On
 *   OneUptime Cloud the master admins are the OneUptime team, and the
 *   Dashboard also sends `feedback/given` (Types/Analytics/ProductEvent):
 *   the kind, topic, score and page, never the words.
 *
 *   Give feedback is a message, not an answer: the person writes to
 *   someone and wants a reply (issue #8893). So it is also emailed
 *   (GiveFeedbackDestination) - on OneUptime Cloud to the OneUptime team at
 *   support@oneuptime.com, on a self-hosted server to its admins at its
 *   Admin Notification Email, never to OneUptime - with the person's name
 *   and email address and the project, copying the person, and a reply
 *   goes to them. A self-hosted server with no Admin Notification Email
 *   emails nothing. The dialog says which before anything is sent.
 *
 * WHAT AN ANSWER CARRIES
 *
 *   The answer itself, the page as a route pattern with no ids
 *   (`/dashboard/:projectId/monitors/:id`) and the product version - nothing
 *   else: no person, no project, no address. readProductFeedbackSubmission
 *   takes only those fields from what is posted, and scrubs the page again.
 *   The row kept names nobody, Give feedback's too: its email, sent by the
 *   server from who is signed in, is what names the person.
 *
 * WHEN ONEUPTIME ASKS (decideFeedbackQuestion)
 *
 *   A question (the setup's, the check-in) is asked once per person, at most
 *   one question a week, never while the project has an open incident or
 *   alert, and never once the person or the server switched questions off.
 *   What the person opens themselves - Give feedback, "Stuck?" under a
 *   setup's steps, the thumbs - is not a question OneUptime asks.
 *
 * React-free and server-free, so the server, the Dashboard and the tests
 * read the same rules.
 */

export enum ProductFeedbackKind {
  SetupFlow = "setup_flow",
  General = "general",
  Explanation = "explanation",
  CheckIn = "check_in",
  // "Was this page helpful?" on a docs page, where kept (#7209).
  DocsPage = "docs_page",
}

// Every kind an answer is kept as: what Admin Dashboard > Feedback lists.
export const PRODUCT_FEEDBACK_KINDS: ReadonlyArray<ProductFeedbackKind> =
  Object.values(ProductFeedbackKind);

/*
 * The kinds the Dashboard posts (POST /product-feedback): every kind but a
 * docs page's, which only the docs server keeps, from the docs' own route.
 */
export const DASHBOARD_FEEDBACK_KINDS: ReadonlyArray<ProductFeedbackKind> =
  PRODUCT_FEEDBACK_KINDS.filter((kind: ProductFeedbackKind): boolean => {
    return kind !== ProductFeedbackKind.DocsPage;
  });

export const isProductFeedbackKind: (
  value: unknown,
) => value is ProductFeedbackKind = (
  value: unknown,
): value is ProductFeedbackKind => {
  return (
    typeof value === "string" &&
    (PRODUCT_FEEDBACK_KINDS as ReadonlyArray<string>).includes(value)
  );
};

export const isDashboardFeedbackKind: (
  value: unknown,
) => value is ProductFeedbackKind = (
  value: unknown,
): value is ProductFeedbackKind => {
  return (
    typeof value === "string" &&
    (DASHBOARD_FEEDBACK_KINDS as ReadonlyArray<string>).includes(value)
  );
};

// The routes (under /api). Server/API/ProductFeedbackAPI.ts serves them.
export const PRODUCT_FEEDBACK_ROUTE: string = "/product-feedback";
export const PRODUCT_FEEDBACK_DETAILS_ROUTE: string =
  "/product-feedback/details";
export const PRODUCT_FEEDBACK_SETTINGS_ROUTE: string =
  "/product-feedback/settings";
export const PRODUCT_FEEDBACK_ASK_ROUTE: string = "/product-feedback/ask";
export const PRODUCT_FEEDBACK_ADMIN_SUMMARY_ROUTE: string =
  "/product-feedback/admin/summary";
export const PRODUCT_FEEDBACK_ADMIN_LIST_ROUTE: string =
  "/product-feedback/admin/list";
/*
 * One answer, for a master admin to delete (#7366):
 * DELETE /product-feedback/admin/answer/:answerId.
 */
export const PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE: string =
  "/product-feedback/admin/answer";

export const getProductFeedbackAdminAnswerRoute: (
  answerId: string,
) => string = (answerId: string): string => {
  return `${PRODUCT_FEEDBACK_ADMIN_ANSWER_ROUTE}/${encodeURIComponent(answerId)}`;
};

/*
 * How long an answer is kept, from when it was given (#7366): a year, then
 * the daily purge deletes it. Long enough to compare one release's answers
 * with the year before's; no longer, as what a person wrote may hold more
 * than they meant to say. The same on every server.
 */
export const PRODUCT_FEEDBACK_RETENTION_IN_DAYS: number = 365;

// What a person may write: a few sentences, not an essay.
export const PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH: number = 2000;
// A topic is a word the code chose: a setup's key, an explanation's.
export const PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH: number = 100;
export const PRODUCT_FEEDBACK_PAGE_MAX_LENGTH: number = 200;
export const PRODUCT_FEEDBACK_VERSION_MAX_LENGTH: number = 40;

// "How easy was that?": 1 is very hard, 5 is very easy.
export const PRODUCT_FEEDBACK_LOWEST_SCORE: number = 1;
export const PRODUCT_FEEDBACK_HIGHEST_SCORE: number = 5;
export const PRODUCT_FEEDBACK_SCORES: ReadonlyArray<number> = [1, 2, 3, 4, 5];

// A score this low or lower is "hard" in the Admin Dashboard's summary.
export const PRODUCT_FEEDBACK_HARD_SCORE: number = 2;

// At most one question a week per person.
export const FEEDBACK_QUESTION_GAP_DAYS: number = 7;

/*
 * The first-week check-in: from the 7th day after a project was made, and
 * no later than the 30th - an older project is long past its first week.
 */
export const CHECK_IN_FIRST_DAY: number = 7;
export const CHECK_IN_LAST_DAY: number = 30;

// Details can be added to an answer this long after it was given.
export const PRODUCT_FEEDBACK_DETAILS_WINDOW_MINUTES: number = 60;

// The topic of the first-week check-in.
export const CHECK_IN_TOPIC: string = "first_week";

/*
 * WHAT GIVE FEEDBACK IS ABOUT (issue #8893): the person picks one as they
 * write, and it is the answer's topic. The dialog asks with it ("What
 * happened?" for something broken), the team reads it first (the email's
 * subject), and the Admin Dashboard counts Give feedback by it.
 */
export enum GiveFeedbackCategory {
  Broken = "broken",
  Confusing = "confusing",
  Idea = "idea",
  Other = "other",
}

// In the order the dialog offers them.
export const GIVE_FEEDBACK_CATEGORIES: ReadonlyArray<GiveFeedbackCategory> = [
  GiveFeedbackCategory.Broken,
  GiveFeedbackCategory.Confusing,
  GiveFeedbackCategory.Idea,
  GiveFeedbackCategory.Other,
];

/*
 * Picked when the dialog opens: what most people reach for Give feedback
 * about. Its question ("What happened?") reads right for most of the rest,
 * and one click picks another.
 */
export const DEFAULT_GIVE_FEEDBACK_CATEGORY: GiveFeedbackCategory =
  GiveFeedbackCategory.Broken;

/*
 * Marks an English name as a key of the Dashboard's locales - the same
 * marker as Common/UI/Utils/TranslateTemplate's translationKey, kept here so
 * this file stays free of the UI. It returns the text unchanged. The
 * Dashboard's locale extractor reads this file for what it marks and
 * nothing else (a "keys" root of its SOURCE_ROOTS,
 * App/FeatureSet/Dashboard/scripts/i18n/ExtractStrings.ts), and so does the
 * Admin Dashboard's locale guard (a catalog of AdminOwnPagesStrings): the
 * Feedback page draws what it marks.
 */
const translationKey: (text: string) => string = (text: string): string => {
  return text;
};

/*
 * Each one's name, as the dialog offers it and the team reads it. English:
 * the Dashboard and the Admin Dashboard translate what they show, and the
 * email to the team is English.
 */
export const GIVE_FEEDBACK_CATEGORY_TITLES: Readonly<
  Record<GiveFeedbackCategory, string>
> = {
  [GiveFeedbackCategory.Broken]: translationKey("Something's broken"),
  [GiveFeedbackCategory.Confusing]: translationKey("Confusing"),
  [GiveFeedbackCategory.Idea]: translationKey("Idea"),
  [GiveFeedbackCategory.Other]: translationKey("Other"),
};

export const isGiveFeedbackCategory: (
  value: unknown,
) => value is GiveFeedbackCategory = (
  value: unknown,
): value is GiveFeedbackCategory => {
  return (
    typeof value === "string" &&
    (GIVE_FEEDBACK_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
};

/*
 * A topic Give feedback was posted with, as a category: anything else -
 * nothing, or where an older Dashboard said it was opened from ("help") -
 * is Other.
 */
export const toGiveFeedbackCategory: (
  value: unknown,
) => GiveFeedbackCategory = (value: unknown): GiveFeedbackCategory => {
  const topic: string = typeof value === "string" ? toFeedbackTopic(value) : "";

  return isGiveFeedbackCategory(topic) ? topic : GiveFeedbackCategory.Other;
};

/*
 * WHERE GIVE FEEDBACK GOES (issue #8893). The server decides, and tells the
 * Dashboard with its settings, so the dialog says it before anything is
 * sent - and only what is true there:
 */
export enum GiveFeedbackDestination {
  /*
   * OneUptime Cloud: emailed to the OneUptime team (ONEUPTIME_SUPPORT_EMAIL)
   * with the person's name and email address and their project, copying
   * the person, and a reply goes to them.
   */
  OneUptimeTeam = "oneuptime_team",
  /*
   * A self-hosted server with an Admin Notification Email (Admin Dashboard
   * > Settings > Email): emailed to its admins there, in the same way,
   * through the server's own mail settings. Nothing goes to OneUptime: a
   * self-hosted server's people, projects and words are its own.
   */
  ServerAdminsByEmail = "server_admins_by_email",
  /*
   * A self-hosted server with none: kept for its admins (Admin Dashboard >
   * Feedback), with no name and no address, and nothing leaves the server.
   */
  ServerAdmins = "server_admins",
}

export const ONEUPTIME_SUPPORT_EMAIL: string = "support@oneuptime.com";

export const getGiveFeedbackDestination: (data: {
  isOneUptimeCloud: boolean;
  adminNotificationEmail: string | null | undefined;
}) => GiveFeedbackDestination = (data: {
  isOneUptimeCloud: boolean;
  adminNotificationEmail: string | null | undefined;
}): GiveFeedbackDestination => {
  if (data.isOneUptimeCloud) {
    return GiveFeedbackDestination.OneUptimeTeam;
  }

  return (data.adminNotificationEmail || "").trim()
    ? GiveFeedbackDestination.ServerAdminsByEmail
    : GiveFeedbackDestination.ServerAdmins;
};

export const isGiveFeedbackEmailed: (
  destination: GiveFeedbackDestination,
) => boolean = (destination: GiveFeedbackDestination): boolean => {
  return destination !== GiveFeedbackDestination.ServerAdmins;
};

/*
 * What POST /product-feedback answers for Give feedback besides the
 * answer's id: whether it is being emailed, and where a copy of it is on
 * its way - the person's own address - or null where none is.
 */
export interface GiveFeedbackReceipt {
  isEmailed: boolean;
  copyTo: string | null;
}

export const readGiveFeedbackReceipt: (
  value: unknown,
) => GiveFeedbackReceipt = (value: unknown): GiveFeedbackReceipt => {
  const data: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  const isEmailed: boolean = data["isEmailed"] === true;
  const copyTo: unknown = data["copyTo"];

  return {
    isEmailed: isEmailed,
    copyTo:
      isEmailed && typeof copyTo === "string" && copyTo.includes("@")
        ? copyTo
        : null,
  };
};

// The pre-filled GitHub issue a self-hosted form offers (NewGitHubIssue).
export const PRODUCT_FEEDBACK_GITHUB_LABEL: string = "feedback";

const MS_PER_DAY: number = 24 * 60 * 60 * 1000;

const TOKEN_UNSAFE_CHARACTERS: RegExp = /[^a-z0-9_.-]/g;

/*
 * A topic as it is kept: a word the code chose, lower case, anything but
 * a-z, 0-9, _, . and - as _, cut to PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH.
 */
export const toFeedbackTopic: (value: string) => string = (
  value: string,
): string => {
  return value
    .trim()
    .toLowerCase()
    .replace(TOKEN_UNSAFE_CHARACTERS, "_")
    .slice(0, PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH);
};

const UUID_LIKE: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HAS_DIGIT: RegExp = /[0-9]/;
const ROUTE_PARAMETER: RegExp = /^:[a-zA-Z][a-zA-Z0-9]*$/;
const PLAIN_SEGMENT: RegExp = /^[a-z][a-z-]*$/;

// The longest segment a page keeps as written: a word, not a value.
const PAGE_SEGMENT_MAX_LENGTH: number = 40;

/*
 * The page an answer was given on, as a route pattern with no ids or
 * values: `/dashboard/:projectId/monitors/:id`. The Dashboard sends the
 * pattern of the route it matched (Feedback/FeedbackPage); this scrubs
 * whatever arrives again, so a full address never reaches the table:
 *
 *   - the query and the fragment are dropped;
 *   - a route parameter (`:projectId`) stays;
 *   - a word of lower-case letters and hyphens stays (`monitors`,
 *     `on-call-duty`);
 *   - anything else - an id, a number, a name, an address, anything with a
 *     digit, a capital, a dot, an @ or an encoded character - becomes `:id`.
 */
export const toFeedbackPage: (value: unknown) => string = (
  value: unknown,
): string => {
  if (typeof value !== "string") {
    return "/";
  }

  const path: string = value.split(/[?#]/)[0] || "";

  const segments: Array<string> = path
    .split("/")
    .filter((segment: string): boolean => {
      return segment.length > 0;
    })
    .map((segment: string): string => {
      if (ROUTE_PARAMETER.test(segment)) {
        return segment;
      }

      if (
        segment.length <= PAGE_SEGMENT_MAX_LENGTH &&
        PLAIN_SEGMENT.test(segment) &&
        !UUID_LIKE.test(segment) &&
        !HAS_DIGIT.test(segment)
      ) {
        return segment;
      }

      return ":id";
    });

  const page: string = `/${segments.join("/")}`;

  if (page.length <= PRODUCT_FEEDBACK_PAGE_MAX_LENGTH) {
    return page;
  }

  // Cut at a segment, never in the middle of one.
  const cut: string = page.slice(0, PRODUCT_FEEDBACK_PAGE_MAX_LENGTH);

  return cut.slice(0, Math.max(1, cut.lastIndexOf("/")));
};

const VERSION_PATTERN: RegExp = /^[0-9A-Za-z.+-]+$/;

// The product version as written ("14.0.108"), or "" for anything else.
export const toFeedbackVersion: (value: unknown) => string = (
  value: unknown,
): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > PRODUCT_FEEDBACK_VERSION_MAX_LENGTH ||
    !VERSION_PATTERN.test(value)
  ) {
    return "";
  }

  return value;
};

// What a person wrote, trimmed and cut to the most it may be; null for nothing.
export const toFeedbackDetails: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const details: string = value
    .trim()
    .slice(0, PRODUCT_FEEDBACK_DETAILS_MAX_LENGTH);

  return details.length > 0 ? details : null;
};

// One answer, as it is kept: these fields and nothing else.
export interface ProductFeedbackSubmission {
  kind: ProductFeedbackKind;
  topic: string;
  // 1 to 5, for "How easy was that?"; null for every other kind.
  score: number | null;
  // Thumbs up, or "Yes" to the check-in; null for a score or Give feedback.
  isPositive: boolean | null;
  // What the person wrote, if anything.
  details: string | null;
  page: string;
  version: string;
  /*
   * What went wrong, for a no to "Was this page helpful?" (docs_page only,
   * written by the docs server): never read from what the Dashboard posts.
   */
  reason?: DocsFeedbackReason | null | undefined;
}

// The names readProductFeedbackSubmission reads; anything else posted is dropped.
export const PRODUCT_FEEDBACK_SUBMISSION_FIELDS: ReadonlyArray<string> = [
  "kind",
  "topic",
  "score",
  "isPositive",
  "details",
  "page",
  "version",
];

const isWholeScore: (value: unknown) => value is number = (
  value: unknown,
): value is number => {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= PRODUCT_FEEDBACK_LOWEST_SCORE &&
    value <= PRODUCT_FEEDBACK_HIGHEST_SCORE
  );
};

/*
 * An answer as the Dashboard posts it, or a sentence that says what is
 * wrong with it (the server answers 400 with it). Each kind carries what
 * it asks and nothing more:
 *
 *   - setup_flow   a topic and a score of 1 to 5; details optional;
 *   - general      details (what the person wrote) and what it is about
 *                  as its topic (GiveFeedbackCategory); no score;
 *   - explanation  a topic and thumbs up or down;
 *   - check_in     yes or not yet; details optional.
 */
export const readProductFeedbackSubmission: (
  body: JSONValue | undefined,
) => ProductFeedbackSubmission | string = (
  body: JSONValue | undefined,
): ProductFeedbackSubmission | string => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Send the answer as a JSON object with its kind, then try again.";
  }

  const data: JSONObject = body as JSONObject;
  const kind: JSONValue | undefined = data["kind"];

  // A docs page's answer is the docs server's to keep (#7209), never posted here.
  if (!isDashboardFeedbackKind(kind)) {
    return `Set kind to one of ${DASHBOARD_FEEDBACK_KINDS.join(", ")}, then send the answer again.`;
  }

  const topic: string =
    typeof data["topic"] === "string" ? toFeedbackTopic(data["topic"]) : "";
  const details: string | null = toFeedbackDetails(data["details"]);
  const page: string = toFeedbackPage(data["page"]);
  const version: string = toFeedbackVersion(data["version"]);

  const base: Omit<ProductFeedbackSubmission, "score" | "isPositive"> = {
    kind: kind,
    topic: topic,
    details: details,
    page: page,
    version: version,
  };

  if (kind === ProductFeedbackKind.SetupFlow) {
    if (!topic) {
      return "Name the guided setup in topic, then send the answer again.";
    }

    if (!isWholeScore(data["score"])) {
      return `Set score to a whole number from ${PRODUCT_FEEDBACK_LOWEST_SCORE} to ${PRODUCT_FEEDBACK_HIGHEST_SCORE}, then send the answer again.`;
    }

    return { ...base, score: data["score"], isPositive: null };
  }

  if (kind === ProductFeedbackKind.General) {
    if (!details) {
      return "Write what you want to tell us, then send it again.";
    }

    return {
      ...base,
      // What it is about (GiveFeedbackCategory): Other for anything else.
      topic: toGiveFeedbackCategory(topic),
      score: null,
      isPositive: null,
    };
  }

  if (typeof data["isPositive"] !== "boolean") {
    return "Set isPositive to true or false, then send the answer again.";
  }

  if (kind === ProductFeedbackKind.Explanation) {
    if (!topic) {
      return "Name the explanation in topic, then send the answer again.";
    }

    // Thumbs carry no words.
    return {
      ...base,
      details: null,
      score: null,
      isPositive: data["isPositive"],
    };
  }

  return {
    ...base,
    topic: CHECK_IN_TOPIC,
    score: null,
    isPositive: data["isPositive"],
  };
};

/*
 * "WAS THIS PAGE HELPFUL?", KEPT ON THIS SERVER (#7209).
 *
 * What went wrong, as a no can say it in one click on the docs page
 * (App/FeatureSet/Docs, Views/Partials/PageFeedback.ejs: the docs' own
 * words, ui.feedbackReason*). Each title is the docs' English, marked as a
 * key: Admin Dashboard > Feedback looks it up in its locales.
 */
export enum DocsFeedbackReason {
  Unclear = "unclear",
  Missing = "missing",
  Wrong = "wrong",
  NotFound = "not_found",
}

// In the order the page offers them.
export const DOCS_FEEDBACK_REASONS: ReadonlyArray<DocsFeedbackReason> = [
  DocsFeedbackReason.Unclear,
  DocsFeedbackReason.Missing,
  DocsFeedbackReason.Wrong,
  DocsFeedbackReason.NotFound,
];

export const DOCS_FEEDBACK_REASON_TITLES: Readonly<
  Record<DocsFeedbackReason, string>
> = {
  [DocsFeedbackReason.Unclear]: translationKey("Hard to follow"),
  [DocsFeedbackReason.Missing]: translationKey("Something is missing"),
  [DocsFeedbackReason.Wrong]: translationKey("Wrong or out of date"),
  [DocsFeedbackReason.NotFound]: translationKey("Not what I was looking for"),
};

export const isDocsFeedbackReason: (
  value: unknown,
) => value is DocsFeedbackReason = (
  value: unknown,
): value is DocsFeedbackReason => {
  return (
    typeof value === "string" &&
    (DOCS_FEEDBACK_REASONS as ReadonlyArray<string>).includes(value)
  );
};

// A docs language's code: "de", "zh-CN".
const DOCS_LANGUAGE_PATTERN: RegExp = /^[a-z]{2}(-[a-z]{2})?$/i;

// A docs page's address under /docs/<lang>/, as the nav writes it.
const DOCS_PAGE_PATTERN: RegExp =
  /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*$/;

/*
 * A docs answer as the docs server keeps it (ProductFeedbackService.
 * keepDocsAnswer): the page as the topic, the page it was read on - its
 * language with it - as the page, and the version. Null for a page that is
 * not one: the docs server reads only pages its nav lists, and this holds
 * the shape again, so no address or value is ever kept.
 */
export const toDocsFeedbackSubmission: (data: {
  page: string;
  language: string;
  isHelpful: boolean;
  reason?: DocsFeedbackReason | undefined;
  version: string;
}) => ProductFeedbackSubmission | null = (data: {
  page: string;
  language: string;
  isHelpful: boolean;
  reason?: DocsFeedbackReason | undefined;
  version: string;
}): ProductFeedbackSubmission | null => {
  if (
    data.page.length > PRODUCT_FEEDBACK_TOPIC_MAX_LENGTH ||
    !DOCS_PAGE_PATTERN.test(data.page) ||
    !DOCS_LANGUAGE_PATTERN.test(data.language)
  ) {
    return null;
  }

  return {
    kind: ProductFeedbackKind.DocsPage,
    topic: data.page,
    score: null,
    isPositive: data.isHelpful,
    // A reason only says what went wrong: never with a yes.
    reason:
      !data.isHelpful && data.reason && isDocsFeedbackReason(data.reason)
        ? data.reason
        : null,
    details: null,
    page: `/docs/${data.language}/${data.page}`,
    version: toFeedbackVersion(data.version),
  };
};

// One docs page's answers, as Admin Dashboard > Feedback lists them.
export interface DocsPageFeedbackSummary {
  // The page under /docs/: "monitor/website-monitor".
  page: string;
  answers: number;
  helpful: number;
  notHelpful: number;
  // What went wrong, by how many noes said it, most first.
  reasons: Array<{ reason: DocsFeedbackReason; answers: number }>;
}

// The fields summarizeDocsPageFeedback reads from each docs answer.
export interface DocsPageFeedbackRow {
  page: string;
  isHelpful: boolean | null;
  reason: string | null;
}

/*
 * The docs pages people answered for, the ones that fail them first: most
 * noes first, then the larger share of noes, then the most answers.
 */
export const summarizeDocsPageFeedback: (
  rows: ReadonlyArray<DocsPageFeedbackRow>,
) => Array<DocsPageFeedbackSummary> = (
  rows: ReadonlyArray<DocsPageFeedbackRow>,
): Array<DocsPageFeedbackSummary> => {
  const byPage: Map<
    string,
    DocsPageFeedbackSummary & { reasonCounts: Map<DocsFeedbackReason, number> }
  > = new Map();

  for (const row of rows) {
    if (!row.page) {
      continue;
    }

    let summary:
      | (DocsPageFeedbackSummary & {
          reasonCounts: Map<DocsFeedbackReason, number>;
        })
      | undefined = byPage.get(row.page);

    if (!summary) {
      summary = {
        page: row.page,
        answers: 0,
        helpful: 0,
        notHelpful: 0,
        reasons: [],
        reasonCounts: new Map(),
      };
      byPage.set(row.page, summary);
    }

    summary.answers++;

    if (row.isHelpful === true) {
      summary.helpful++;
    } else if (row.isHelpful === false) {
      summary.notHelpful++;

      if (isDocsFeedbackReason(row.reason)) {
        summary.reasonCounts.set(
          row.reason,
          (summary.reasonCounts.get(row.reason) || 0) + 1,
        );
      }
    }
  }

  return Array.from(byPage.values())
    .map(
      (
        summary: DocsPageFeedbackSummary & {
          reasonCounts: Map<DocsFeedbackReason, number>;
        },
      ): DocsPageFeedbackSummary => {
        const { reasonCounts, ...rest } = summary;

        return {
          ...rest,
          reasons: DOCS_FEEDBACK_REASONS.filter(
            (reason: DocsFeedbackReason): boolean => {
              return reasonCounts.has(reason);
            },
          )
            .map((reason: DocsFeedbackReason) => {
              return { reason: reason, answers: reasonCounts.get(reason) || 0 };
            })
            .sort(
              (
                a: { reason: DocsFeedbackReason; answers: number },
                b: { reason: DocsFeedbackReason; answers: number },
              ): number => {
                return b.answers - a.answers;
              },
            ),
        };
      },
    )
    .sort((a: DocsPageFeedbackSummary, b: DocsPageFeedbackSummary): number => {
      return (
        b.notHelpful - a.notHelpful ||
        b.notHelpful / b.answers - a.notHelpful / a.answers ||
        b.answers - a.answers ||
        a.page.localeCompare(b.page)
      );
    });
};

/*
 * QUESTIONS ONEUPTIME ASKS
 *
 * A question is the setup's end question or the check-in. Its key names
 * what was asked: `setup_flow:website_down`, `check_in:<project id>`. Each
 * person's keys and when each was asked are kept on their user record
 * (User.feedbackQuestionsAsked), so another browser asks nothing twice.
 */
export const getFeedbackQuestionKey: (data: {
  kind: ProductFeedbackKind;
  topic: string;
}) => string = (data: { kind: ProductFeedbackKind; topic: string }): string => {
  return `${data.kind}:${toFeedbackTopic(data.topic)}`;
};

// A key as the Dashboard posts it, or null for anything else.
export const readFeedbackQuestionKey: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const separator: number = value.indexOf(":");

  if (separator < 0) {
    return null;
  }

  const kind: string = value.slice(0, separator);
  const topic: string = value.slice(separator + 1);

  // Only the questions OneUptime asks: a setup's, and the check-in.
  if (
    kind !== ProductFeedbackKind.SetupFlow &&
    kind !== ProductFeedbackKind.CheckIn
  ) {
    return null;
  }

  if (!topic || toFeedbackTopic(topic) !== topic) {
    return null;
  }

  return `${kind}:${topic}`;
};

// The most question keys a person's record keeps; the oldest go first.
export const FEEDBACK_QUESTIONS_KEPT: number = 100;

/*
 * The questions a person was asked, read from their record: key to when
 * (an ISO date). Anything that is not a key and a date is dropped.
 */
export const readAskedQuestions: (
  value: JSONValue | null | undefined,
) => Record<string, string> = (
  value: JSONValue | null | undefined,
): Record<string, string> => {
  const asked: Record<string, string> = {};

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return asked;
  }

  for (const [key, when] of Object.entries(value as JSONObject)) {
    if (
      readFeedbackQuestionKey(key) === key &&
      typeof when === "string" &&
      !Number.isNaN(new Date(when).getTime())
    ) {
      asked[key] = when;
    }
  }

  return asked;
};

// The asked questions with one more, keeping the newest FEEDBACK_QUESTIONS_KEPT.
export const withAskedQuestion: (data: {
  asked: Record<string, string>;
  key: string;
  now: Date;
}) => Record<string, string> = (data: {
  asked: Record<string, string>;
  key: string;
  now: Date;
}): Record<string, string> => {
  const entries: Array<[string, string]> = Object.entries({
    ...data.asked,
    [data.key]: data.now.toISOString(),
  }).sort((a: [string, string], b: [string, string]): number => {
    return new Date(b[1]).getTime() - new Date(a[1]).getTime();
  });

  return Object.fromEntries(entries.slice(0, FEEDBACK_QUESTIONS_KEPT));
};

export enum FeedbackQuestionDecision {
  Ask = "ask",
  // The server's master admins switched questions off (Admin > Feedback).
  ServerOff = "server_off",
  // The person switched them off (User Profile, or "Don't ask me again").
  PersonOff = "person_off",
  // This question was asked before.
  AlreadyAsked = "already_asked",
  // The project has an open incident or alert: not now.
  IncidentOpen = "incident_open",
  // Another question was asked in the last FEEDBACK_QUESTION_GAP_DAYS days.
  AskedRecently = "asked_recently",
}

// Whether to ask a question now, and if not, why not.
export const decideFeedbackQuestion: (data: {
  key: string;
  isServerOn: boolean;
  isPersonOn: boolean;
  asked: Record<string, string>;
  isIncidentOpen: boolean;
  now: Date;
}) => FeedbackQuestionDecision = (data: {
  key: string;
  isServerOn: boolean;
  isPersonOn: boolean;
  asked: Record<string, string>;
  isIncidentOpen: boolean;
  now: Date;
}): FeedbackQuestionDecision => {
  if (!data.isServerOn) {
    return FeedbackQuestionDecision.ServerOff;
  }

  if (!data.isPersonOn) {
    return FeedbackQuestionDecision.PersonOff;
  }

  if (data.asked[data.key]) {
    return FeedbackQuestionDecision.AlreadyAsked;
  }

  if (data.isIncidentOpen) {
    return FeedbackQuestionDecision.IncidentOpen;
  }

  const gapMs: number = FEEDBACK_QUESTION_GAP_DAYS * MS_PER_DAY;

  const askedRecently: boolean = Object.values(data.asked).some(
    (when: string): boolean => {
      const askedAtMs: number = new Date(when).getTime();

      return data.now.getTime() - askedAtMs < gapMs;
    },
  );

  if (askedRecently) {
    return FeedbackQuestionDecision.AskedRecently;
  }

  return FeedbackQuestionDecision.Ask;
};

/*
 * Whether a project is in its check-in window: from CHECK_IN_FIRST_DAY
 * days after it was made to CHECK_IN_LAST_DAY.
 */
export const isCheckInDue: (data: {
  projectCreatedAt: Date | string | null | undefined;
  now: Date;
}) => boolean = (data: {
  projectCreatedAt: Date | string | null | undefined;
  now: Date;
}): boolean => {
  if (!data.projectCreatedAt) {
    return false;
  }

  const createdAtMs: number = new Date(data.projectCreatedAt).getTime();

  if (Number.isNaN(createdAtMs)) {
    return false;
  }

  const ageMs: number = data.now.getTime() - createdAtMs;

  return (
    ageMs >= CHECK_IN_FIRST_DAY * MS_PER_DAY &&
    ageMs <= CHECK_IN_LAST_DAY * MS_PER_DAY
  );
};

/*
 * GET /product-feedback/settings: whether this server asks (the master
 * admins' switch), whether it asks this person (their own), and where Give
 * feedback goes (GiveFeedbackDestination), for the dialog to say.
 */
export interface ProductFeedbackSettings {
  isOn: boolean;
  isAskingMe: boolean;
  giveFeedbackGoesTo?: GiveFeedbackDestination | undefined;
}

const GIVE_FEEDBACK_DESTINATIONS: ReadonlyArray<string> = Object.values(
  GiveFeedbackDestination,
);

export const readProductFeedbackSettings: (
  value: unknown,
) => ProductFeedbackSettings | null = (
  value: unknown,
): ProductFeedbackSettings | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const data: Record<string, unknown> = value as Record<string, unknown>;

  if (
    typeof data["isOn"] !== "boolean" ||
    typeof data["isAskingMe"] !== "boolean"
  ) {
    return null;
  }

  const giveFeedbackGoesTo: unknown = data["giveFeedbackGoesTo"];

  return {
    isOn: data["isOn"],
    isAskingMe: data["isAskingMe"],
    ...(typeof giveFeedbackGoesTo === "string" &&
    GIVE_FEEDBACK_DESTINATIONS.includes(giveFeedbackGoesTo)
      ? { giveFeedbackGoesTo: giveFeedbackGoesTo as GiveFeedbackDestination }
      : {}),
  };
};

/*
 * THE ADMIN DASHBOARD'S VIEW (Feedback): one answer as listed, and the
 * summary of the last PRODUCT_FEEDBACK_SUMMARY_DAYS days.
 */
export const PRODUCT_FEEDBACK_SUMMARY_DAYS: number = 90;
export const PRODUCT_FEEDBACK_LIST_PAGE_SIZE: number = 25;
export const PRODUCT_FEEDBACK_LIST_MAX_PAGE_SIZE: number = 100;

export interface ProductFeedbackListItem {
  id: string;
  kind: ProductFeedbackKind;
  topic: string;
  score: number | null;
  isPositive: boolean | null;
  details: string | null;
  // What went wrong, for a no to "Was this page helpful?"; null otherwise.
  reason?: DocsFeedbackReason | null | undefined;
  page: string;
  version: string;
  // ISO date.
  createdAt: string;
}

export interface ProductFeedbackListPage {
  items: Array<ProductFeedbackListItem>;
  count: number;
}

// The answers to one question (a setup, an explanation, the check-in).
export interface ProductFeedbackTopicSummary {
  kind: ProductFeedbackKind;
  topic: string;
  answers: number;
  // For setup_flow: the average score, to one decimal; null otherwise.
  averageScore: number | null;
  // For setup_flow: answers of PRODUCT_FEEDBACK_HARD_SCORE or lower.
  hardAnswers: number;
  // Thumbs up / Yes, and thumbs down / Not yet.
  positiveAnswers: number;
  negativeAnswers: number;
  // Answers the person wrote something with.
  answersWithDetails: number;
}

// One Ask AI answer rated down, with the question that led to it.
export interface AskAiRatedDownAnswer {
  // What the person asked, cut to ASK_AI_QUESTION_PREVIEW_LENGTH.
  question: string;
  // ISO date.
  ratedAt: string;
}

export const ASK_AI_QUESTION_PREVIEW_LENGTH: number = 300;
export const ASK_AI_RATED_DOWN_LIST_SIZE: number = 25;

/*
 * Ask AI's thumbs (#6828 stored them; nothing read them). The questions
 * rated down are listed only on a self-hosted server, whose admins already
 * hold that data; on OneUptime Cloud they are customers' questions about
 * their own projects, so the team sees only the counts (null) - and, on
 * every server, what the answers rated down drew on (Types/AI/AskAiRatings,
 * #7365): the products whose data they read, the docs, or nothing, never
 * a word of them.
 */
export interface AskAiRatingsSummary {
  helpful: number;
  notHelpful: number;
  ratedDown: Array<AskAiRatedDownAnswer> | null;
  ratedDownDrewOn?: Array<AskAiSourceCount> | undefined;
}

export interface ProductFeedbackAdminSummary {
  sinceDays: number;
  // How long an answer is kept (PRODUCT_FEEDBACK_RETENTION_IN_DAYS, #7366).
  retentionInDays?: number | undefined;
  // Every kind but a docs page's: those are docsPages.
  topics: Array<ProductFeedbackTopicSummary>;
  // "Was this page helpful?", by page, where the server keeps it (#7209).
  docsPages?: Array<DocsPageFeedbackSummary> | undefined;
  askAi: AskAiRatingsSummary;
}

// The fields summarizeProductFeedback reads from each answer.
export interface ProductFeedbackSummaryRow {
  kind: ProductFeedbackKind;
  topic: string;
  score: number | null;
  isPositive: boolean | null;
  hasDetails: boolean;
}

/*
 * The answers, by question: setups first (hardest first, by average
 * score), then the check-in, then explanations (least clear first), then
 * Give feedback. A docs page's answers are summed up by page instead
 * (summarizeDocsPageFeedback), so they are left out here.
 */
export const summarizeProductFeedback: (
  rows: ReadonlyArray<ProductFeedbackSummaryRow>,
) => Array<ProductFeedbackTopicSummary> = (
  rows: ReadonlyArray<ProductFeedbackSummaryRow>,
): Array<ProductFeedbackTopicSummary> => {
  const byQuestion: Map<
    string,
    ProductFeedbackTopicSummary & { scoreTotal: number; scoreCount: number }
  > = new Map();

  for (const row of rows) {
    if (row.kind === ProductFeedbackKind.DocsPage) {
      continue;
    }

    const key: string = `${row.kind}:${row.topic}`;
    let summary:
      | (ProductFeedbackTopicSummary & {
          scoreTotal: number;
          scoreCount: number;
        })
      | undefined = byQuestion.get(key);

    if (!summary) {
      summary = {
        kind: row.kind,
        topic: row.topic,
        answers: 0,
        averageScore: null,
        hardAnswers: 0,
        positiveAnswers: 0,
        negativeAnswers: 0,
        answersWithDetails: 0,
        scoreTotal: 0,
        scoreCount: 0,
      };
      byQuestion.set(key, summary);
    }

    summary.answers++;

    if (isWholeScore(row.score)) {
      summary.scoreTotal += row.score;
      summary.scoreCount++;

      if (row.score <= PRODUCT_FEEDBACK_HARD_SCORE) {
        summary.hardAnswers++;
      }
    }

    if (row.isPositive === true) {
      summary.positiveAnswers++;
    } else if (row.isPositive === false) {
      summary.negativeAnswers++;
    }

    if (row.hasDetails) {
      summary.answersWithDetails++;
    }
  }

  const kindOrder: Array<ProductFeedbackKind> = [
    ProductFeedbackKind.SetupFlow,
    ProductFeedbackKind.CheckIn,
    ProductFeedbackKind.Explanation,
    ProductFeedbackKind.General,
  ];

  return Array.from(byQuestion.values())
    .map(
      (
        summary: ProductFeedbackTopicSummary & {
          scoreTotal: number;
          scoreCount: number;
        },
      ): ProductFeedbackTopicSummary => {
        const { scoreTotal, scoreCount, ...rest } = summary;

        return {
          ...rest,
          averageScore:
            scoreCount > 0
              ? Math.round((scoreTotal / scoreCount) * 10) / 10
              : null,
        };
      },
    )
    .sort((a: ProductFeedbackTopicSummary, b: ProductFeedbackTopicSummary) => {
      const byKind: number =
        kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind);

      if (byKind !== 0) {
        return byKind;
      }

      if (a.kind === ProductFeedbackKind.SetupFlow) {
        return (a.averageScore ?? 0) - (b.averageScore ?? 0);
      }

      if (a.kind === ProductFeedbackKind.Explanation) {
        return (
          b.negativeAnswers / b.answers - a.negativeAnswers / a.answers ||
          b.answers - a.answers
        );
      }

      return b.answers - a.answers;
    });
};

/*
 * WHAT AN ANSWER WAS ABOUT, IN WORDS (the Admin Dashboard's Feedback page):
 * a guided setup by its name, How OneUptime works, a term of the Glossary,
 * the check-in, and what Give feedback was about (GiveFeedbackCategory).
 * English: the page translates what it shows.
 */
export const GUIDED_SETUP_TITLES: Readonly<Record<string, string>> = {
  website_down: translationKey("Know when my website or API is down"),
  on_call: translationKey("Page the right person when something breaks"),
  status_page: translationKey("Publish a status page"),
  telemetry: translationKey("Send logs, metrics and traces, then get alerted"),
};

/*
 * Marked as keys (#8893): the Admin Dashboard's Feedback page looks each up
 * by what an answer is about, so no lookup of its own names them, and they
 * read English in every language until its locales had them
 * (AdminOwnPagesStrings reads this file as a catalog).
 */
export const PRODUCT_FEEDBACK_KIND_TITLES: Readonly<
  Record<ProductFeedbackKind, string>
> = {
  [ProductFeedbackKind.SetupFlow]: translationKey("Guided setup"),
  [ProductFeedbackKind.General]: translationKey("Give feedback"),
  [ProductFeedbackKind.Explanation]: translationKey("Was this clear?"),
  [ProductFeedbackKind.CheckIn]: translationKey("First-week check-in"),
  [ProductFeedbackKind.DocsPage]: translationKey("Was this page helpful?"),
};

export const getProductFeedbackTopicTitle: (data: {
  kind: ProductFeedbackKind;
  topic: string;
}) => string = (data: { kind: ProductFeedbackKind; topic: string }): string => {
  if (data.kind === ProductFeedbackKind.SetupFlow) {
    return GUIDED_SETUP_TITLES[data.topic] || data.topic;
  }

  // A docs page by its address under /docs/: what the page links to.
  if (data.kind === ProductFeedbackKind.DocsPage) {
    return data.topic;
  }

  if (data.kind === ProductFeedbackKind.Explanation) {
    if (data.topic === "how_oneuptime_works") {
      return translationKey("How OneUptime works");
    }

    if (data.topic.startsWith("term.")) {
      return `Glossary: ${data.topic.slice("term.".length).replace(/-/g, " ")}`;
    }

    return data.topic;
  }

  if (data.kind === ProductFeedbackKind.CheckIn) {
    return translationKey("Is OneUptime set up the way you wanted?");
  }

  /*
   * Give feedback: what it was about. An answer kept before #8893 holds
   * where Give feedback was opened instead ("help"), shown as it was kept.
   */
  if (isGiveFeedbackCategory(data.topic)) {
    return GIVE_FEEDBACK_CATEGORY_TITLES[data.topic];
  }

  return data.topic;
};
