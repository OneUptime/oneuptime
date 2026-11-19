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
 *   is the words of a search that found nothing - in the Dashboard's Search
 *   or the docs' search box - on OneUptime Cloud only: the best sign of
 *   what people cannot find (issue #6830's decision). Even those carry no
 *   personal data (#7207): every word that could name or reach a person or
 *   a record is taken out first - an email address, a web or IP address, a
 *   host name, a number (toSearchQueryWords) - and what is left is cut to
 *   SEARCH_QUERY_MAX_LENGTH characters. FORBIDDEN_PROPERTY_WORDS is the
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
  // A product was opened from How OneUptime works (#8891).
  HowItWorksProductOpened = "how_it_works/product_opened",

  // A search in the command palette (Cmd/Ctrl+K) found nothing.
  SearchFoundNothing = "search/no_results",

  // Ask AI.
  AskAiQuestionAsked = "ask_ai/question_asked",
  AskAiAnswerRated = "ask_ai/answer_rated",

  // Ask AI sets things up (#6829): a plan proposed, approved, then tested.
  AskAiSetupProposed = "ask_ai/setup_proposed",
  AskAiSetupApproved = "ask_ai/setup_approved",
  AskAiSetupTestPageSent = "ask_ai/setup_test_page_sent",
  /*
   * The guided setups and Ask AI link to each other (#7245): a guided
   * setup's Describe it instead, and a plan's Open in guided setup.
   */
  AskAiSetupDescribedInstead = "ask_ai/setup_described_instead",
  AskAiSetupOpenedInGuidedSetup = "ask_ai/setup_opened_in_guided_setup",

  // "Import from another tool" was opened.
  ImporterOpened = "importer/opened",

  // "Was this page helpful?" on a docs page (#6822): sent by the docs server.
  DocsFeedbackGiven = "docs/feedback_given",
  // A docs search that found nothing (#7207): sent by the docs server.
  DocsSearchFoundNothing = "docs/search_found_nothing",
  // A docs page opened from the product (#7207): its link, button or Search.
  DocsLinkOpened = "docs/link_opened",

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
  SetupHealthFixApplied = "setup_health/fix_applied",
  // How to reach me (#6820): a paging ladder saved, and the grid opened.
  PagingLadderSaved = "paging_ladder/saved",
  PagingLadderGridOpened = "paging_ladder/grid_opened",
  /*
   * The project's default ladder (#7449) saved, and applied to members from
   * On-Call Readiness (#7450).
   */
  PagingLadderDefaultSaved = "paging_ladder/default_saved",
  PagingLadderDefaultApplied = "paging_ladder/default_applied",
  // A person's own steps filled with the project's default (#9445).
  PagingLadderStartedFromDefault = "paging_ladder/started_from_default",

  // "Used by" (#6813): the full list of what refers to a record was opened.
  UsedByListOpened = "used_by/list_opened",

  /*
   * "When this goes down" (#7079): its chain opened, and a fix opened from
   * one of its breaks or owners who aren't emailed. Never a name.
   */
  WhoIsToldChainOpened = "who_is_told/chain_opened",
  WhoIsToldFixOpened = "who_is_told/fix_opened",

  /*
   * Putting a status page, a dashboard or a form on its own domain (#7024):
   * Add Custom Domain opened, the domain added to the project, each DNS
   * record Check now looked up, the domain verified, and a self-hosted
   * server that is not ready for custom domains yet. Never a domain's name.
   */
  CustomDomainAddStarted = "custom_domain/add_started",
  CustomDomainProjectDomainAdded = "custom_domain/project_domain_added",
  CustomDomainRecordChecked = "custom_domain/record_checked",
  CustomDomainVerified = "custom_domain/verified",
  CustomDomainServerNotReady = "custom_domain/server_not_ready",
}

// The words of a search that found nothing, at most this long (Cloud only).
export const SEARCH_QUERY_MAX_LENGTH: number = 40;

/*
 * Whether a word of a search could name or reach a person, or name a
 * record (#7207). It does when it holds:
 *
 *   - an @: an email address, a handle;
 *   - a scheme ("https://") or starts with "www.": a web address;
 *   - a dot between two letters: a host or a file's name, a first.last
 *     user name;
 *   - two digits in a row: a phone number, an IP or a postal address, a
 *     date, an id;
 *   - a digit, in a word longer than 6 characters: an id or a key
 *     ("a1b2c3d4").
 *
 * A product's own short names with a digit stay: k8s, ec2, ipv6, oauth2.
 */
const WEB_ADDRESS_START: RegExp = /^www\./i;
const DOT_BETWEEN_LETTERS: RegExp = /\p{L}\.\p{L}/u;
const TWO_DIGITS: RegExp = /\d\d/;
const A_DIGIT: RegExp = /\d/;

export const isSearchWordThatIdentifies: (word: string) => boolean = (
  word: string,
): boolean => {
  return (
    word.includes("@") ||
    word.includes("://") ||
    WEB_ADDRESS_START.test(word) ||
    DOT_BETWEEN_LETTERS.test(word) ||
    TWO_DIGITS.test(word) ||
    (A_DIGIT.test(word) && word.length > 6)
  );
};

/*
 * The words of a search as an event may carry them (#7207): each word that
 * could name or reach a person or a record taken out (see above), and what
 * is left cut to SEARCH_QUERY_MAX_LENGTH characters, at a word where it
 * can. "maya@acme.example sso 10.0.0.4 setup" is "sso setup".
 */
export const toSearchQueryWords: (value: string) => string = (
  value: string,
): string => {
  const words: string = value
    .split(/\s+/)
    .filter((word: string): boolean => {
      return word.length > 0 && !isSearchWordThatIdentifies(word);
    })
    .join(" ");

  if (words.length <= SEARCH_QUERY_MAX_LENGTH) {
    return words;
  }

  const cut: string = words.slice(0, SEARCH_QUERY_MAX_LENGTH);
  const lastSpace: number = cut.lastIndexOf(" ");

  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
};

// A word-like value (a step's key, where something was opened from) is cut to this.
export const PRODUCT_EVENT_TOKEN_MAX_LENGTH: number = 60;

// The page a feedback answer was given on: a route with no ids, cut to this.
export const FEEDBACK_PAGE_TOKEN_MAX_LENGTH: number = 200;

/*
 * The kinds of break a chain names, joined by "." (who_is_told/
 * chain_opened): long enough for every kind there is.
 */
export const WHO_IS_TOLD_BREAK_KINDS_MAX_LENGTH: number = 200;

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
  /*
   * The words of a search: every word that could name or reach a person
   * taken out first (toSearchQueryWords), and left out when none is left.
   */
  isSearchWords?: boolean | undefined;
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

/*
 * The words of a search that found nothing: on Cloud only, with no word
 * that could name or reach a person (toSearchQueryWords), cut short.
 */
const searchWordsProperty: ProductEventPropertySpec = {
  name: "query",
  isCloudOnly: true,
  isSearchWords: true,
  maxLength: SEARCH_QUERY_MAX_LENGTH,
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
      'A "How it works" explanation was opened: a product\'s, from beside the page\'s title, or How OneUptime works (product "oneuptime"), from Help, Home, the Welcome checklist, Search or the phone menu (source).',
    properties: [token("product"), token("source")],
  },
  {
    name: ProductEventName.HowItWorksProductOpened,
    description:
      'A product was opened from How OneUptime works: from one of the four steps a problem moves through (place "loop"), or from its category\'s list (place "category"). The product is its key, never its name.',
    properties: [token("product"), token("place")],
  },
  {
    name: ProductEventName.SearchFoundNothing,
    description:
      "A search in the command palette settled with no result. On Cloud, with the words typed, cut short, and none that could name or reach a person.",
    properties: [
      token("source"),
      { name: "query_length" },
      searchWordsProperty,
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
    name: ProductEventName.AskAiSetupDescribedInstead,
    description:
      "Describe it instead was pressed on a guided setup's first step: Ask AI opened with the setup's goal in its composer, unsent. Which setup (setup: website_down, on_call, status_page, telemetry).",
    properties: [token("setup")],
  },
  {
    name: ProductEventName.AskAiSetupOpenedInGuidedSetup,
    description:
      "Open in guided setup was pressed on an Ask AI setup plan's card: the guided setup it opened (setup) and the plan's parts (parts, as ask_ai/setup_proposed names them).",
    properties: [token("setup"), token("parts")],
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
    name: ProductEventName.DocsSearchFoundNothing,
    description:
      "A search in the docs' search box settled with nothing found: 2 characters or more, a second after the docs server answered with no page, or when the box closed on it. Sent by the docs server (Docs/Utils/DocsSearchReport), only where product analytics is set up and with the reader's consent. On Cloud, with the words typed, cut short, and none that could name or reach a person.",
    properties: [{ name: "query_length" }, searchWordsProperty],
  },
  {
    name: ProductEventName.DocsLinkOpened,
    description:
      'A docs page was opened from the product: a "Learn more" link (source learn_more), a list\'s View Documentation (view_documentation) or a docs result of Search (search). The page is its address under /docs/, without its language or anchor.',
    properties: [
      {
        name: "page",
        isToken: true,
        maxLength: FEEDBACK_PAGE_TOKEN_MAX_LENGTH,
      },
      token("source"),
    ],
  },
  {
    name: ProductEventName.GuidedSetupStarted,
    description:
      "A guided setup was opened, and where from when the way in names itself (from: empty_list, how_it_works, create_monitor, website_down_summary, home, ask_ai).",
    properties: [token("setup"), token("from")],
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
      "Somebody pinned a product to the nav bar (from the products menu), and how many they have pinned now.",
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
    name: ProductEventName.SetupHealthFixApplied,
    description:
      "A Setup health finding was fixed in one click, after its dialog said what would change: which check, at which level.",
    properties: [token("check"), token("level")],
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
    name: ProductEventName.PagingLadderDefaultSaved,
    description:
      "The project's default ladder for new members was saved in Project Settings > Notifications > Notification Channels: how many steps it has (0: turned off).",
    properties: [{ name: "step_count" }],
  },
  {
    name: ProductEventName.PagingLadderDefaultApplied,
    description:
      "The project's default ladder was applied from On-Call Readiness to the members picked: how many were picked, and how many got it, were skipped or failed.",
    properties: [
      { name: "member_count" },
      { name: "applied_count" },
      { name: "skipped_count" },
      { name: "failed_count" },
    ],
  },
  {
    name: ProductEventName.PagingLadderStartedFromDefault,
    description:
      "Start From the Project's Default filled a paging ladder on How to Reach Me with the project's default, before it was saved: by the person or for a member, how many steps it gave, and how many of the default's channels it left out as not verified.",
    properties: [
      { name: "is_own" },
      { name: "step_count" },
      { name: "left_out_count" },
    ],
  },
  {
    name: ProductEventName.UsedByListOpened,
    description:
      'The full list of what refers to a record was opened: a relation\'s "See all" on a record\'s Used by card (relation), or a label\'s Used by (relation "all").',
    properties: [token("record_kind"), token("relation")],
  },
  {
    name: ProductEventName.WhoIsToldChainOpened,
    description:
      "Show the chain was opened on When this goes down: where the card is (place), how many breaks it named and of which kinds, and how many owners it said aren't emailed.",
    properties: [
      token("place"),
      { name: "break_count" },
      {
        name: "break_kinds",
        isToken: true,
        maxLength: WHO_IS_TOLD_BREAK_KINDS_MAX_LENGTH,
      },
      { name: "owners_not_emailed_count" },
    ],
  },
  {
    name: ProductEventName.WhoIsToldFixOpened,
    description:
      "A fix was opened from When this goes down: where the card is (place), the break it puts right or owner_not_emailed (kind), and the page it opens (fix).",
    properties: [token("place"), token("kind"), token("fix")],
  },
  {
    name: ProductEventName.CustomDomainAddStarted,
    description:
      "Add Custom Domain was opened, for a status page, a dashboard or a form (kind).",
    properties: [token("kind")],
  },
  {
    name: ProductEventName.CustomDomainProjectDomainAdded,
    description:
      "Add Custom Domain added the address's domain to the project, which did not have it yet: its TXT record comes next.",
    properties: [token("kind")],
  },
  {
    name: ProductEventName.CustomDomainRecordChecked,
    description:
      "Check now looked up one of a custom domain's DNS records in DNS Setup: which record (txt, cname), what it found (outcome), and which Check now of the dialog it was. For a CNAME, whether a proxy hides it, whether a request reached OneUptime, and the HTTP status of one that did not.",
    properties: [
      token("kind"),
      token("record"),
      token("outcome"),
      { name: "check_number" },
      { name: "is_proxied" },
      { name: "reached_one_uptime" },
      { name: "http_status" },
    ],
  },
  {
    name: ProductEventName.CustomDomainVerified,
    description:
      "Check now verified a custom domain in DNS Setup: what happens to its certificate next, how many records it took (record_count) and at which Check now of the dialog.",
    properties: [
      token("kind"),
      token("certificate_status"),
      { name: "record_count" },
      { name: "check_number" },
    ],
  },
  {
    name: ProductEventName.CustomDomainServerNotReady,
    description:
      "A self-hosted server said it is not ready for custom domains yet, in Add Custom Domain or DNS Setup (source), and which of its checks failed. Sent only where the server's own admin set up product analytics: OneUptime Cloud checks nothing of the kind.",
    properties: [
      token("kind"),
      token("source"),
      token("failed_checks"),
      { name: "failed_count" },
    ],
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
  query: `The words of a search that found nothing: on Cloud only, with every word that could name or reach a person taken out, cut to ${SEARCH_QUERY_MAX_LENGTH} characters (search/no_results and docs/search_found_nothing, issue #6830's decision and #7207).`,
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
      if (spec.isSearchWords) {
        const words: string = toSearchQueryWords(value);

        // Nothing left that could be sent: the property is left out.
        if (words) {
          allowed[spec.name] =
            spec.maxLength !== undefined
              ? words.slice(0, spec.maxLength)
              : words;
        }

        continue;
      }

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
