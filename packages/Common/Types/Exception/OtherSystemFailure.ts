import { JSONObject, JSONValue } from "../JSON";

/*
 * ANOTHER SYSTEM'S FAILURE, IN ONEUPTIME'S WORDS FIRST (#7268, the rule in
 * Docs/ux/README.md#errors).
 *
 * When something outside OneUptime fails - an SMTP server, Twilio, a chat
 * tool, a cloud, an LLM provider, the website a probe checks - the person
 * reads what happened and what to do next in OneUptime's words, in their
 * language. The other system's own words come second, exactly as it gave
 * them, folded under "Details" with a copy button (OtherSystemDetails): for
 * a support ticket, or that system's own help pages. Before, the person
 * often read that system's words alone ("Invalid login: 535-5.7.8 Username
 * and Password not accepted"), or OneUptime's sentence with them glued on.
 *
 * The server answers with OneUptime's sentence as its error message, as it
 * always did - an API client, the CLI and Terraform read it as it is - and
 * the other system's words beside it, in the answer's otherSystemDetails
 * field (OtherSystemFailureException). A page reads them back with
 * readOtherSystemDetails. React-free and server-safe.
 */
export interface OtherSystemFailure {
  // What happened, in OneUptime's words: "The test email was not sent."
  whatHappened: string;
  /*
   * What to do next: a fix the person can make, who can make it, or Try
   * again. "Check the host, port, username and password, then send it
   * again."
   */
  whatToDo: string;
  // The other system's own words, as it gave them. Never translated.
  details?: string | undefined;
}

// The field of an error answer that carries the other system's own words.
export const OTHER_SYSTEM_DETAILS_FIELD: string = "otherSystemDetails";

/*
 * The longest the other system's words are kept: a mail server's answer, a
 * cloud's error with its request id, a stack trace. Longer words are cut,
 * and say so.
 */
export const MAX_OTHER_SYSTEM_DETAILS_LENGTH: number = 4000;

// What a cut stops with.
const CUT_MARK: string = "…";

/*
 * The sentence a person reads first: what happened, then what to do next,
 * as one message (a key of the Dashboard's locales when it has no values).
 */
export const getOtherSystemFailureMessage: (
  failure: Pick<OtherSystemFailure, "whatHappened" | "whatToDo">,
) => string = (
  failure: Pick<OtherSystemFailure, "whatHappened" | "whatToDo">,
): string => {
  return [failure.whatHappened, failure.whatToDo]
    .map((sentence: string): string => {
      return (sentence || "").trim();
    })
    .filter(Boolean)
    .join(" ");
};

/*
 * The other system's words as they are kept and shown: as text, trimmed,
 * cut at MAX_OTHER_SYSTEM_DETAILS_LENGTH - or none, for no words, and for
 * words that only say again what OneUptime's sentence already says.
 */
export const toOtherSystemDetails: (
  words: unknown,
  message?: string | undefined,
) => string | undefined = (
  words: unknown,
  message?: string | undefined,
): string | undefined => {
  let text: string = "";

  if (typeof words === "string") {
    text = words;
  } else if (words instanceof Error) {
    text = words.message;
  } else if (words !== undefined && words !== null) {
    try {
      text = JSON.stringify(words) || "";
    } catch {
      text = String(words);
    }
  }

  text = text.trim();

  if (!text || (message !== undefined && text === message.trim())) {
    return undefined;
  }

  if (text.length > MAX_OTHER_SYSTEM_DETAILS_LENGTH) {
    return `${text.substring(0, MAX_OTHER_SYSTEM_DETAILS_LENGTH - CUT_MARK.length)}${CUT_MARK}`;
  }

  return text;
};

/*
 * What an error answer adds beside its message for the other system's
 * words: the field, or nothing when there are none.
 */
export const getOtherSystemDetailsAnswer: (
  details: string | undefined,
) => JSONObject = (details: string | undefined): JSONObject => {
  return details ? { [OTHER_SYSTEM_DETAILS_FIELD]: details } : {};
};

/*
 * The other system's words an answer carries, from the answer's body or
 * from an error that holds one (an HTTPErrorResponse's data): null when it
 * carries none.
 */
export const readOtherSystemDetails: (answer: unknown) => string | null = (
  answer: unknown,
): string | null => {
  if (!answer || typeof answer !== "object") {
    return null;
  }

  const body: JSONObject | undefined =
    (answer as { data?: unknown }).data &&
    typeof (answer as { data?: unknown }).data === "object"
      ? ((answer as { data: JSONObject }).data as JSONObject)
      : undefined;

  for (const holder of [body, answer as JSONObject]) {
    const value: JSONValue | undefined = holder?.[OTHER_SYSTEM_DETAILS_FIELD];

    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }

  return null;
};
