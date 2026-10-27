import SecurityEventRequestOutcome from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The words of a security event's request: what happened next, and where
 * the event came from. Each is an en.json key, looked up where it is drawn
 * (SecurityEventRequestStory writes the sentences with the reader's
 * translator).
 *
 * React-free, so a plain test pins the words beside the rules that choose
 * them.
 */

// ---------- What happened next ----------

/*
 * How far a request got, as the outcome pill and the Campaigns bar name it:
 * the stored values themselves, so a reader filters by the word they see.
 */
export const REQUEST_OUTCOME_LABELS: Record<SecurityEventRequestOutcome, string> =
  {
    [SecurityEventRequestOutcome.Rejected]: translationKey("Rejected"),
    [SecurityEventRequestOutcome.ReachedApp]: translationKey("Reached App"),
    [SecurityEventRequestOutcome.Errored]: translationKey("Errored"),
    [SecurityEventRequestOutcome.ReachedDatabase]:
      translationKey("Reached Database"),
  };

export const WHAT_HAPPENED_NEXT_TITLE: string =
  translationKey("What happened next");

export const REJECTED_IN: string = translationKey(
  "The app turned it away: it answered {{status}} in {{duration}}.",
);

export const REJECTED: string = translationKey(
  "The app turned it away: it answered {{status}}.",
);

export const REACHED_APP_IN: string = translationKey(
  "A handler ran and answered {{status}} in {{duration}}. Open the trace to see what it did.",
);

export const REACHED_APP: string = translationKey(
  "A handler ran and answered {{status}}. Open the trace to see what it did.",
);

export const ERRORED_WITH_STATUS_AND_EXCEPTION: string = translationKey(
  "It broke something: the app answered {{status}} and threw {{exception}}.",
);

export const ERRORED_WITH_EXCEPTION: string = translationKey(
  "It broke something: the request threw {{exception}}.",
);

export const ERRORED_WITH_STATUS: string = translationKey(
  "It broke something: the app answered {{status}}.",
);

export const ERRORED: string = translationKey(
  "It broke something: a span of the request failed.",
);

export const REACHED_DATABASE_IN_SYSTEM: string = translationKey(
  "The injected SQL ran: a {{system}} query the request made holds it.",
);

export const REACHED_DATABASE: string = translationKey(
  "The injected SQL ran: a query the request made holds it.",
);

export const REACHED_DATABASE_BY_DELAY: string = translationKey(
  "The injected SQL ran: the request took {{duration}}, as long as its SQL asked the database to wait.",
);

export const NOT_FOLLOWED_WITH_TRACE: string = translationKey(
  "OneUptime has this request's trace but not the span that answered it, so it can't say how far the request got.",
);

export const CHECKING_TRACE: string = translationKey(
  "Reading the request's trace…",
);

export const DATABASE_QUERY_LABEL: string = translationKey("Query");

// Who sent it, as the request's facts say.
export const FROM_ADDRESS: string = translationKey("From {{address}}");
export const SIGNED_IN_AS: string = translationKey("Signed in as {{user}}");

// The event's own fields, below what happened and where it came from.
export const DETAILS_TITLE: string = translationKey("Details");

// ---------- Where it came from ----------

export const WHERE_IT_CAME_FROM_TITLE: string =
  translationKey("Where it came from");

export const FROM_A_LOG_LINE_OF: string = translationKey(
  "A log line {{service}} wrote",
);

export const FROM_A_LOG_LINE: string = translationKey(
  "A log line from your telemetry",
);

export const FROM_SOURCE: string = translationKey("Sent by {{source}}");

export const NO_TRACE_FOR_LOG_LINE: string = translationKey(
  "This line wasn't written inside a traced request, so OneUptime can't follow it. Send traces from this service to see what each attack did next.",
);

export const LOG_LINE_LABEL: string = translationKey("Log line");
export const LOG_LINE_NOT_FOUND: string = translationKey(
  "The log line is no longer kept: logs are removed after their retention period.",
);
export const LOG_LINE_NOT_PERMITTED: string = translationKey(
  "Reading logs takes a Telemetry role.",
);
export const SHOW_WHOLE_LINE: string = translationKey("Show the whole line");
export const SHOW_LESS: string = translationKey("Show less");

export const VIEW_TRACE: string = translationKey("View trace");
export const VIEW_EXCEPTION: string = translationKey("View exception");
export const WATCH_SESSION: string = translationKey("Watch session");
export const VIEW_REQUEST_LOGS: string = translationKey("Logs of this request");
export const VIEW_LOGS_AROUND: string = translationKey("Logs around it");

export const VIEW_TRACE_HINT: string = translationKey(
  "Every span of the request this event happened in",
);
export const VIEW_EXCEPTION_HINT: string = translationKey(
  "The exception the request threw, and every other time it was thrown",
);
export const WATCH_SESSION_HINT: string = translationKey(
  "A replay of the browser session, at the moment of the event",
);
export const VIEW_REQUEST_LOGS_HINT: string = translationKey(
  "Every log line the request wrote, in the Logs explorer",
);
export const VIEW_LOGS_AROUND_HINT: string = translationKey(
  "This service's logs in the second around the line, in the Logs explorer",
);
