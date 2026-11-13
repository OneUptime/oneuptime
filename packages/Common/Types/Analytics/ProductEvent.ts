import { JSONObject, JSONValue } from "../JSON";
import { GOALS_EVENT_VALUE_MAX_LENGTH } from "../WelcomeChecklist/ProjectGoal";

/*
 * The behaviour events the Dashboard sends to product analytics (issue
 * #6830), and the one rule every event follows. Written down for people in
 * Docs/analytics/activation.md; the tests hold that page, this file and the
 * code to each other (Tests/Types/Analytics).
 *
 * THE NAMING RULE
 *
 *   `area/thing_happened`: the product area or flow, a slash, then what
 *   happened, in the past tense, lower case with underscores -
 *   `search/no_results`, `guided_setup/finished`, `activation/
 *   first_monitor_created`. The events sent before the rule
 *   (`server/monitor_created`, `dashboard/home/search-opened`, ...) keep
 *   their names: dashboards are built on them.
 *
 * WHAT EVERY EVENT CARRIES
 *
 *   project_id, plan, edition (cloud, enterprise or community), language
 *   (the Dashboard's) and is_project_creator (whether the person created
 *   the project) - added by ProductEvents.send (Common/UI/Utils) to every
 *   event below. A server event carries what the server knows of these
 *   (project_id, plan, edition).
 *
 * WHAT NO EVENT CARRIES
 *
 *   A name (of a person, a project, a monitor, anything), an email or any
 *   other address, a phone number, or text somebody wrote - a message, a
 *   note, a title, a description, a question to Ask AI. The one exception
 *   is the words of a search that found nothing, on OneUptime Cloud only,
 *   cut to SEARCH_QUERY_MAX_LENGTH characters: the best sign of what people
 *   cannot find (issue #6830's decision). FORBIDDEN_PROPERTY_WORDS is the
 *   list the tests scan every event's property names with.
 *
 * WHERE EVENTS GO
 *
 *   Only where product analytics is set up - ANALYTICS_KEY and
 *   ANALYTICS_HOST, which OneUptime Cloud sets and a self-hosted server
 *   does not - and in the browser only with the visitor's consent and
 *   without Global Privacy Control (Utils/Analytics). A self-hosted server
 *   sends nothing.
 *
 * ADDING AN EVENT
 *
 *   A value in ProductEventName, its entry in PRODUCT_EVENTS (each property
 *   it may carry - anything else is dropped before it is sent), a row in
 *   Docs/analytics/activation.md, and the call: ProductEvents.send(
 *   ProductEventName.X, { ... }). An event a later issue will send is
 *   marked with `reservedFor` until it is sent somewhere.
 */

export enum ProductEventName {
  // The Welcome checklist on Home, kept on the server (#6803).
  GoalsChosen = "home/goals_chosen",
  ChecklistStepStarted = "home/checklist_step_started",
  ChecklistStepCompleted = "home/checklist_step_completed",
  ChecklistFinished = "home/checklist_finished",
  ChecklistDismissed = "home/checklist_dismissed",

  // An invited member's own first steps on Home (#6807).
  MemberStepStarted = "home/member_step_started",
  MemberStepsDismissed = "home/member_steps_dismissed",

  // A product's "How it works" explanation was opened.
  HowItWorksOpened = "how_it_works/opened",

  // A search in the command palette (Cmd/Ctrl+K) found nothing.
  SearchFoundNothing = "search/no_results",

  // Ask AI.
  AskAiQuestionAsked = "ask_ai/question_asked",
  AskAiAnswerRated = "ask_ai/answer_rated",

  // Ask AI sets things up (#6829): a plan proposed, approved, then tested.
  AskAiSetupProposed = "ask_ai/setup_proposed",
  AskAiSetupApproved = "ask_ai/setup_approved",
  AskAiSetupTestPageSent = "ask_ai/setup_test_page_sent",

  // "Import from another tool" was opened.
  ImporterOpened = "importer/opened",

  // "Was this page helpful?" on a docs page (#6822): sent by the docs server.
  DocsFeedbackGiven = "docs/feedback_given",

  // The guided setups (#6804, #6805, #6806).
  GuidedSetupStarted = "guided_setup/started",
  GuidedSetupStepReached = "guided_setup/step_reached",
  GuidedSetupFinished = "guided_setup/finished",
  GuidedSetupLeft = "guided_setup/left",

  /*
   * Somebody told OneUptime how something went (#6832): "How easy was
   * that?" at the end of a guided setup, Give feedback, "Was this clear?"
   * or the first-week check-in. Never the words they wrote.
   */
  FeedbackGiven = "feedback/given",

  // Products that fit the project: hidden, shown and pinned (#6814).
  ProductHidden = "products/product_hidden",
  ProductShown = "products/product_shown",
  AllProductsShown = "products/all_products_shown",
  ProductPinned = "products/product_pinned",
  ProductUnpinned = "products/product_unpinned",
  // Setup health (#6812): what is misconfigured in the project.
  SetupHealthOpened = "setup_health/opened",
  SetupHealthFixOpened = "setup_health/fix_opened",
  SetupHealthFindingDismissed = "setup_health/finding_dismissed",
  SetupHealthFindingRestored = "setup_health/finding_restored",
  // How to reach me (#6820): a paging ladder saved, and the grid opened.
  PagingLadderSaved = "paging_ladder/saved",
  PagingLadderGridOpened = "paging_ladder/grid_opened",

  // "Used by" (#6813): the full list of what refers to a record was opened.
  UsedByListOpened = "used_by/list_opened",
  /*
   * A sample project (#6808): made or opened again from an entry point,
   * and deleted from its bar. The only events a sample sends: nothing done
   * inside one is a project getting value (ProductEvents.send).
   */
  SampleProjectStarted = "sample_project/started",
  SampleProjectDeleted = "sample_project/deleted",
}

// The words of a search that found nothing, at most this long (Cloud only).
export const SEARCH_QUERY_MAX_LENGTH: number = 40;

// A word-like value (a step's key, where something was opened from) is cut to this.
export const PRODUCT_EVENT_TOKEN_MAX_LENGTH: number = 60;

// The page a feedback answer was given on: a route with no ids, cut to this.
export const FEEDBACK_PAGE_TOKEN_MAX_LENGTH: number = 200;

export interface ProductEventPropertySpec {
  name: string;
  /*
   * Sent only on OneUptime Cloud, where the privacy notice covers it - and
   * dropped everywhere else.
   */
  isCloudOnly?: boolean | undefined;
  // A string is cut to this many characters before it is sent.
  maxLength?: number | undefined;
  /*
   * A word the code chose - a step's key, a product, where something was
   * opened from - never words a person typed: lower-cased, and anything but
   * a-z, 0-9, _, -, . and / becomes _ (toProductEventToken).
   */
  isToken?: boolean | undefined;
}

export interface ProductEventDefinition {
  name: ProductEventName;
  // When it is sent, in a sentence (Docs/analytics/activation.md says more).
  description: string;
  properties: ReadonlyArray<ProductEventPropertySpec>;
  /*
   * The issue that will send it, while nothing does yet. The tests fail
   * once an event is sent and still marked, and when one is not marked and
   * not sent.
   */
  reservedFor?: string | undefined;
}

// What ProductEvents.send adds to every event above.
export const COMMON_PRODUCT_EVENT_PROPERTIES: ReadonlyArray<string> = [
  "project_id",
  "plan",
  "edition",
  "language",
  "is_project_creator",
];

const token: (name: string) => ProductEventPropertySpec = (
  name: string,
): ProductEventPropertySpec => {
  return {
    name: name,
    isToken: true,
    maxLength: PRODUCT_EVENT_TOKEN_MAX_LENGTH,
  };
};

const TOKEN_UNSAFE_CHARACTERS: RegExp = /[^a-z0-9_./-]/g;

/*
 * A value as a token property carries it (ProductEventPropertySpec.isToken):
 * cut to the property's own length, or PRODUCT_EVENT_TOKEN_MAX_LENGTH.
 */
export const toProductEventToken: (
  value: string,
  maxLength?: number | undefined,
) => string = (value: string, maxLength?: number | undefined): string => {
  return value
    .toLowerCase()
    .replace(TOKEN_UNSAFE_CHARACTERS, "_")
    .slice(0, maxLength ?? PRODUCT_EVENT_TOKEN_MAX_LENGTH);
};

/*
 * The goals a project chose (ProjectGoal values joined by ".", in order:
 * toGoalsEventValue), on the checklist's events, so the funnel splits by
 * goal. Long enough for every goal.
 */
const goalsProperty: ProductEventPropertySpec = {
  name: "goals",
  isToken: true,
  maxLength: GOALS_EVENT_VALUE_MAX_LENGTH,
};

export const PRODUCT_EVENTS: ReadonlyArray<ProductEventDefinition> = [
  {
    name: ProductEventName.GoalsChosen,
    description:
      'The project\'s goals were chosen on Home ("What do you want to do first?"), skipped (no goals), or changed.',
    properties: [goalsProperty, { name: "goal_count" }, { name: "is_change" }],
  },
  {
    name: ProductEventName.ChecklistStepStarted,
    description:
      "A step of the Welcome checklist on Home was opened: its page, its guided setup, or Billing when the plan holds it back.",
    properties: [token("step"), goalsProperty, token("needs_plan")],
  },
  {
    name: ProductEventName.ChecklistStepCompleted,
    description:
      "A step of the Welcome checklist on Home was seen done for the first time.",
    properties: [token("step"), goalsProperty],
  },
  {
    name: ProductEventName.ChecklistFinished,
    description:
      "Every step of the Welcome checklist on Home was seen done for the first time.",
    properties: [{ name: "step_count" }, goalsProperty],
  },
  {
    name: ProductEventName.ChecklistDismissed,
    description:
      "Somebody hid the Welcome checklist on Home for themselves, and how far it was.",
    properties: [{ name: "done_count" }, { name: "step_count" }, goalsProperty],
  },
  {
    name: ProductEventName.MemberStepStarted,
    description:
      "An invited member opened one of their own first steps on Home: their setup checklist, a test page to themselves, their shifts or the mobile app.",
    properties: [token("step")],
  },
  {
    name: ProductEventName.MemberStepsDismissed,
    description:
      "An invited member hid their own first steps on Home, and how many were left.",
    properties: [{ name: "open_count" }],
  },
  {
    name: ProductEventName.HowItWorksOpened,
    description:
      'A "How it works" explanation was opened: a product\'s, from beside the page\'s title, or How OneUptime works (product "oneuptime"), from Help, Home, Search or the phone menu (source).',
    properties: [token("product"), token("source")],
  },
  {
    name: ProductEventName.SearchFoundNothing,
    description:
      "A search in the command palette settled with no result. On Cloud, with the words typed, cut short.",
    properties: [
      token("source"),
      { name: "query_length" },
      {
        name: "query",
        isCloudOnly: true,
        maxLength: SEARCH_QUERY_MAX_LENGTH,
      },
    ],
  },
  {
    name: ProductEventName.AskAiQuestionAsked,
    description:
      "A question was sent to Ask AI. Never the question: whether it started a conversation, and the permission mode.",
    properties: [{ name: "is_new_conversation" }, token("permission_mode")],
  },
  {
    name: ProductEventName.AskAiAnswerRated,
    description:
      "An Ask AI answer was rated helpful or not helpful, or its rating was cleared.",
    properties: [token("rating")],
  },
  {
    name: ProductEventName.AskAiSetupProposed,
    description:
      "Ask AI proposed a setup plan on one approval card: its parts (paging, website_monitor, status_page, status_page_monitors), how many, and the permission mode.",
    properties: [
      token("parts"),
      { name: "part_count" },
      token("permission_mode"),
    ],
  },
  {
    name: ProductEventName.AskAiSetupApproved,
    description:
      "A setup plan's card was answered: the parts approved, and how many were approved and skipped.",
    properties: [
      token("parts"),
      { name: "approved_count" },
      { name: "skipped_count" },
    ],
  },
  {
    name: ProductEventName.AskAiSetupTestPageSent,
    description:
      "A test page was sent from under an answer that set something up: to yourself or to the policy it made (target).",
    properties: [token("target")],
  },
  {
    name: ProductEventName.ImporterOpened,
    description:
      '"Import from another tool" was opened, and from where (?from= on its address, "settings" when it says nothing).',
    properties: [token("from")],
  },
  {
    name: ProductEventName.DocsFeedbackGiven,
    description:
      'A docs page was rated by "Was this page helpful?", on docs where product analytics is set up (OneUptime Cloud), with what went wrong when a no says (reason). Sent by the docs server (Docs/Utils/DocsFeedback).',
    properties: [token("page"), { name: "is_helpful" }, token("reason")],
  },
  {
    name: ProductEventName.GuidedSetupStarted,
    description: "A guided setup was opened.",
    properties: [token("setup")],
  },
  {
    name: ProductEventName.GuidedSetupStepReached,
    description: "A guided setup moved on to a step.",
    properties: [token("setup"), token("step"), { name: "step_number" }],
  },
  {
    name: ProductEventName.GuidedSetupFinished,
    description:
      "A guided setup reached its end: the thing works and was tested.",
    properties: [token("setup"), { name: "seconds_taken" }],
  },
  {
    name: ProductEventName.GuidedSetupLeft,
    description: "A guided setup was left before its end, and at which step.",
    properties: [token("setup"), token("step"), { name: "step_number" }],
  },
  {
    name: ProductEventName.FeedbackGiven,
    description:
      'Somebody answered "How easy was that?" at the end of a guided setup, sent Give feedback, rated an explanation ("Was this clear?") or answered the first-week check-in: the kind, what it was about (topic), the score or thumbs, whether they wrote anything (has_details) and the page as a route with no ids. Never what they wrote.',
    properties: [
      token("kind"),
      token("topic"),
      { name: "score" },
      { name: "is_positive" },
      { name: "has_details" },
      {
        name: "page",
        isToken: true,
        maxLength: FEEDBACK_PAGE_TOKEN_MAX_LENGTH,
      },
    ],
  },
  {
    name: ProductEventName.ProductHidden,
    description:
      "A product was hidden in the project (Project Settings > Products, or Home's Keep hidden), and whether it had data.",
    properties: [token("product"), token("source"), { name: "has_data" }],
  },
  {
    name: ProductEventName.ProductShown,
    description:
      "A hidden product was shown again in the project (Project Settings > Products, or Home's Show it).",
    properties: [token("product"), token("source")],
  },
  {
    name: ProductEventName.AllProductsShown,
    description:
      "Every product was shown again in the project, and how many had been hidden.",
    properties: [{ name: "hidden_count" }],
  },
  {
    name: ProductEventName.ProductPinned,
    description:
      "Somebody pinned a product to the nav bar (from the products menu or the product's page), and how many they have pinned now.",
    properties: [token("product"), token("source"), { name: "pin_count" }],
  },
  {
    name: ProductEventName.ProductUnpinned,
    description:
      "Somebody unpinned a product from the nav bar, and how many they have pinned now.",
    properties: [token("product"), token("source"), { name: "pin_count" }],
  },
  {
    name: ProductEventName.SetupHealthOpened,
    description:
      'Setup health was opened, from where (?from= on its address, "direct" when it says nothing), and how many findings of each level it showed.',
    properties: [
      token("source"),
      { name: "pages_will_not_arrive_count" },
      { name: "worth_fixing_count" },
      { name: "suggestion_count" },
      { name: "dismissed_count" },
    ],
  },
  {
    name: ProductEventName.SetupHealthFixOpened,
    description:
      "The fix of a Setup health finding was opened: which check, at which level.",
    properties: [token("check"), token("level")],
  },
  {
    name: ProductEventName.SetupHealthFindingDismissed,
    description:
      "A Setup health finding was dismissed for everyone: which check, and whether a reason was given (never the reason).",
    properties: [token("check"), { name: "has_reason" }],
  },
  {
    name: ProductEventName.SetupHealthFindingRestored,
    description: "A dismissed Setup health finding was restored.",
    properties: [token("check")],
  },
  {
    name: ProductEventName.PagingLadderSaved,
    description:
      "A paging ladder was saved on How to Reach Me: by the person or for a member, how many steps, and how many cards that differed it replaced.",
    properties: [
      { name: "is_own" },
      { name: "step_count" },
      { name: "replaced_card_count" },
    ],
  },
  {
    name: ProductEventName.PagingLadderGridOpened,
    description:
      "The per-severity grid behind a paging ladder was opened on How to Reach Me, and how many cards differed from the ladder then.",
    properties: [{ name: "is_own" }, { name: "differing_card_count" }],
  },
  {
    name: ProductEventName.UsedByListOpened,
    description:
      'The full list of what refers to a record was opened: a relation\'s "See all" on a record\'s Used by card (relation), or a label\'s Used by (relation "all").',
    properties: [token("record_kind"), token("relation")],
  },
  {
    name: ProductEventName.SampleProjectStarted,
    description:
      "Explore Sample Project was pressed: where (from - welcome, goals, home), and whether a sample was made or the person's existing one opened (is_new).",
    properties: [token("from"), { name: "is_new" }],
  },
  {
    name: ProductEventName.SampleProjectDeleted,
    description:
      "A sample project was deleted from its bar, and how many days after it was made (days_kept).",
    properties: [{ name: "days_kept" }],
  },
];

/*
 * The words a property name may not hold, split at underscores and capital
 * letters: `project_name`, `toEmail` and `message_text` hold one each. The
 * tests scan every event's property names - these, the server's and the
 * ones sent before the rule - with it.
 */
export const FORBIDDEN_PROPERTY_WORDS: ReadonlyArray<string> = [
  "name",
  "names",
  "email",
  "emails",
  "mail",
  "address",
  "addresses",
  "phone",
  "message",
  "messages",
  "text",
  "body",
  "title",
  "description",
  "content",
  "comment",
  "note",
  "notes",
  "question",
  "answer",
  "password",
  "token",
  "secret",
  "ip",
];

/*
 * Property names that hold a forbidden word and are allowed anyway, each
 * with why: none of them carries what the word suggests.
 */
export const ALLOWED_PROPERTY_NAMES_WITH_FORBIDDEN_WORDS: Readonly<
  Record<string, string>
> = {
  has_password:
    "Whether the person signed up with a password (server/user_created): true or false.",
  query: `The words of a search that found nothing: on Cloud only, cut to ${SEARCH_QUERY_MAX_LENGTH} characters (search/no_results, issue #6830's decision).`,
  utm_content:
    "The utm_content of the link a person signed up through: the ad or link variant a campaign named, not text anyone wrote.",
  utmContent:
    "utm_content as the sign-up page keeps it (utm_event): the ad or link variant a campaign named.",
};

export const getPropertyNameWords: (propertyName: string) => Array<string> = (
  propertyName: string,
): Array<string> => {
  return propertyName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
};

// Whether a property name holds a word no event may carry.
export const isForbiddenPropertyName: (propertyName: string) => boolean = (
  propertyName: string,
): boolean => {
  if (ALLOWED_PROPERTY_NAMES_WITH_FORBIDDEN_WORDS[propertyName]) {
    return false;
  }

  return getPropertyNameWords(propertyName).some((word: string): boolean => {
    return FORBIDDEN_PROPERTY_WORDS.includes(word);
  });
};

export const getProductEventDefinition: (
  name: ProductEventName,
) => ProductEventDefinition | null = (
  name: ProductEventName,
): ProductEventDefinition | null => {
  return (
    PRODUCT_EVENTS.find((event: ProductEventDefinition): boolean => {
      return event.name === name;
    }) || null
  );
};

/*
 * The properties an event may carry, as they may be sent: only the ones its
 * definition lists, a Cloud-only one only on Cloud, strings cut to their
 * length, and only plain values - a string, a number or true/false. What is
 * not listed is dropped, so a property nobody reviewed is never sent.
 */
export const toProductEventProperties: (data: {
  name: ProductEventName;
  properties?: JSONObject | undefined;
  isCloud: boolean;
}) => JSONObject = (data: {
  name: ProductEventName;
  properties?: JSONObject | undefined;
  isCloud: boolean;
}): JSONObject => {
  const definition: ProductEventDefinition | null = getProductEventDefinition(
    data.name,
  );
  const allowed: JSONObject = {};

  if (!definition || !data.properties) {
    return allowed;
  }

  for (const spec of definition.properties) {
    if (spec.isCloudOnly && !data.isCloud) {
      continue;
    }

    const value: JSONValue | undefined = data.properties[spec.name];

    if (typeof value === "string") {
      const text: string = spec.isToken
        ? toProductEventToken(value, spec.maxLength)
        : value;

      allowed[spec.name] =
        spec.maxLength !== undefined ? text.slice(0, spec.maxLength) : text;
    } else if (
      (typeof value === "number" && Number.isFinite(value)) ||
      typeof value === "boolean"
    ) {
      allowed[spec.name] = value;
    }
  }

  return allowed;
};
