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
 *                  was trying to do and what happened.
 *   - explanation  "Was this clear?" under How OneUptime works and a term's
 *                  definition: thumbs up or down. The explanation is the
 *                  topic (`how_oneuptime_works`, `term.criteria`).
 *   - check_in     "Is OneUptime set up the way you wanted?", once, on Home,
 *                  for the project's creator in its first weeks.
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
 * WHAT AN ANSWER CARRIES
 *
 *   The answer itself, the page as a route pattern with no ids
 *   (`/dashboard/:projectId/monitors/:id`) and the product version - nothing
 *   else: no person, no project, no address. readProductFeedbackSubmission
 *   takes only those fields from what is posted, and scrubs the page again.
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
}

export const PRODUCT_FEEDBACK_KINDS: ReadonlyArray<ProductFeedbackKind> =
  Object.values(ProductFeedbackKind);

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

// The topic of the first-week check-in and of Give feedback.
export const CHECK_IN_TOPIC: string = "first_week";
export const GENERAL_FEEDBACK_TOPIC: string = "help";

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
 *   - general      details (what the person was trying to do); no score;
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

  if (!isProductFeedbackKind(kind)) {
    return `Set kind to one of ${PRODUCT_FEEDBACK_KINDS.join(", ")}, then send the answer again.`;
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
      return "Write what you were trying to do and what happened, then send it again.";
    }

    return {
      ...base,
      topic: topic || GENERAL_FEEDBACK_TOPIC,
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
  /*
   * The project is a sample (issue #6808): made up for looking around, so
   * nothing done in it says how OneUptime is to use. Never asked there.
   */
  SampleProject = "sample_project",
}

// Whether to ask a question now, and if not, why not.
export const decideFeedbackQuestion: (data: {
  key: string;
  isServerOn: boolean;
  isPersonOn: boolean;
  asked: Record<string, string>;
  isIncidentOpen: boolean;
  now: Date;
  // The project asked from is a sample (issue #6808): never asked there.
  isSampleProject?: boolean | undefined;
}) => FeedbackQuestionDecision = (data: {
  key: string;
  isServerOn: boolean;
  isPersonOn: boolean;
  asked: Record<string, string>;
  isIncidentOpen: boolean;
  now: Date;
  isSampleProject?: boolean | undefined;
}): FeedbackQuestionDecision => {
  if (!data.isServerOn) {
    return FeedbackQuestionDecision.ServerOff;
  }

  if (!data.isPersonOn) {
    return FeedbackQuestionDecision.PersonOff;
  }

  if (data.isSampleProject) {
    return FeedbackQuestionDecision.SampleProject;
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
 * admins' switch) and whether it asks this person (their own).
 */
export interface ProductFeedbackSettings {
  isOn: boolean;
  isAskingMe: boolean;
}

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

  return { isOn: data["isOn"], isAskingMe: data["isAskingMe"] };
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
 * their own projects, so the team sees only the counts (null).
 */
export interface AskAiRatingsSummary {
  helpful: number;
  notHelpful: number;
  ratedDown: Array<AskAiRatedDownAnswer> | null;
}

export interface ProductFeedbackAdminSummary {
  sinceDays: number;
  topics: Array<ProductFeedbackTopicSummary>;
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
 * Give feedback.
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
 * the check-in, and where Give feedback was opened. English: the page
 * translates what it shows.
 */
export const GUIDED_SETUP_TITLES: Readonly<Record<string, string>> = {
  website_down: "Know when my website or API is down",
  on_call: "Page the right person when something breaks",
  status_page: "Publish a status page",
  telemetry: "Send logs, metrics and traces, then get alerted",
};

export const PRODUCT_FEEDBACK_KIND_TITLES: Readonly<
  Record<ProductFeedbackKind, string>
> = {
  [ProductFeedbackKind.SetupFlow]: "Guided setup",
  [ProductFeedbackKind.General]: "Give feedback",
  [ProductFeedbackKind.Explanation]: "Was this clear?",
  [ProductFeedbackKind.CheckIn]: "First-week check-in",
};

export const getProductFeedbackTopicTitle: (data: {
  kind: ProductFeedbackKind;
  topic: string;
}) => string = (data: { kind: ProductFeedbackKind; topic: string }): string => {
  if (data.kind === ProductFeedbackKind.SetupFlow) {
    return GUIDED_SETUP_TITLES[data.topic] || data.topic;
  }

  if (data.kind === ProductFeedbackKind.Explanation) {
    if (data.topic === "how_oneuptime_works") {
      return "How OneUptime works";
    }

    if (data.topic.startsWith("term.")) {
      return `Glossary: ${data.topic.slice("term.".length).replace(/-/g, " ")}`;
    }

    return data.topic;
  }

  if (data.kind === ProductFeedbackKind.CheckIn) {
    return "Is OneUptime set up the way you wanted?";
  }

  return data.topic;
};
