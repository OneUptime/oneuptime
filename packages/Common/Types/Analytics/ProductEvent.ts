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

  // "Import from another tool" was opened.
  ImporterOpened = "importer/opened",

  // "Was this page helpful?" on a docs page (#6822).
  DocsFeedbackGiven = "docs/feedback_given",

  // The guided setups (#6804, #6805, #6806).
  GuidedSetupStarted = "guided_setup/started",
  GuidedSetupStepReached = "guided_setup/step_reached",
  GuidedSetupFinished = "guided_setup/finished",
  GuidedSetupLeft = "guided_setup/left",
}

// The words of a search that found nothing, at most this long (Cloud only).
export const SEARCH_QUERY_MAX_LENGTH: number = 40;

// A word-like value (a step's key, where something was opened from) is cut to this.
export const PRODUCT_EVENT_TOKEN_MAX_LENGTH: number = 60;

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
    name: ProductEventName.ImporterOpened,
    description:
      '"Import from another tool" was opened, and from where (?from= on its address, "settings" when it says nothing).',
    properties: [token("from")],
  },
  {
    name: ProductEventName.DocsFeedbackGiven,
    description: 'A docs page was rated by "Was this page helpful?".',
    properties: [token("page"), { name: "is_helpful" }],
    reservedFor: "#6822",
  },
  {
    name: ProductEventName.GuidedSetupStarted,
    description: "A guided setup was opened.",
    properties: [token("setup")],
    reservedFor: "#6804",
  },
  {
    name: ProductEventName.GuidedSetupStepReached,
    description: "A guided setup moved on to a step.",
    properties: [token("setup"), token("step"), { name: "step_number" }],
    reservedFor: "#6804",
  },
  {
    name: ProductEventName.GuidedSetupFinished,
    description:
      "A guided setup reached its end: the thing works and was tested.",
    properties: [token("setup"), { name: "seconds_taken" }],
    reservedFor: "#6804",
  },
  {
    name: ProductEventName.GuidedSetupLeft,
    description: "A guided setup was left before its end, and at which step.",
    properties: [token("setup"), token("step"), { name: "step_number" }],
    reservedFor: "#6804",
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
