import { fillTemplate, translationKey } from "../Translator";

/*
 * An error nobody explained (#6836): the server failed in a way no message
 * describes (a TypeError, a lost database connection), OneUptime could not
 * be reached, or the page itself failed. These used to read "Server Error.
 * Please try again", which says nothing a person can act on.
 *
 * Now each says what happened and what to do next, and a failure on the
 * server carries a reference: the first eight characters of the id the
 * server gives every request, which every log record of that request
 * carries (Common/Server/Utils/StartServer, TelemetryContext), and which the
 * server's last-resort handler names in a log line of its own. A person
 * gives it to their administrator or to support; an administrator searches
 * the logs for it.
 *
 * The English sentences below are what travels: the API answers with the
 * server's (an API client, the CLI and Terraform read it as it is), and
 * API.getFriendlyMessage returns one of the four for every error it cannot
 * otherwise put into words. The Dashboard, Accounts and Admin Dashboard read
 * them back (readUnexplainedError) and draw them with ErrorExplanation, in
 * the reader's language, with Try again, the reference and a copy button.
 * The sentences are keys of every app's locales: this file is a "keys" root
 * of the Dashboard's extractor. React-free and server-safe.
 */

// The field of an error answer that holds the reference.
export const ERROR_REFERENCE_FIELD: string = "reference";

// How many characters of the request's id the reference keeps.
export const ERROR_REFERENCE_LENGTH: number = 8;

/*
 * The reference for a request's id: its first eight hex digits, lower case,
 * or null when the id has fewer (no id at all, outside a request).
 */
export const toErrorReference: (
  requestId: string | undefined | null,
) => string | null = (requestId: string | undefined | null): string | null => {
  let hex: string = "";

  for (const character of (requestId || "").toLowerCase()) {
    if (
      (character >= "0" && character <= "9") ||
      (character >= "a" && character <= "f")
    ) {
      hex += character;
    }

    if (hex.length === ERROR_REFERENCE_LENGTH) {
      return hex;
    }
  }

  return null;
};

// Whether a value is a reference: eight lower-case hex digits.
export const isErrorReference: (value: unknown) => value is string = (
  value: unknown,
): value is string => {
  if (typeof value !== "string" || value.length !== ERROR_REFERENCE_LENGTH) {
    return false;
  }

  for (const character of value) {
    if (
      !(
        (character >= "0" && character <= "9") ||
        (character >= "a" && character <= "f")
      )
    ) {
      return false;
    }
  }

  return true;
};

// The kinds of error nobody explained.
export enum UnexplainedErrorKind {
  // The server failed, and named a reference for its logs.
  ServerWithReference = "ServerWithReference",
  // The server failed and named no reference (an older server, a proxy).
  Server = "Server",
  /*
   * The gateway in front of OneUptime answered for it (a 502 or a 504 page):
   * the server is down or restarting - on a new self-hosted install, often
   * a container that keeps stopping (#1741).
   */
  ServerDown = "ServerDown",
  // OneUptime could not be reached at all.
  Unreachable = "Unreachable",
  // The page failed before or after it asked the server.
  Page = "Page",
}

/*
 * What API.getFriendlyMessage has always said for a gateway's 502 or 504
 * page. Kept word for word - tests, fixtures and nginx's comments quote it -
 * and drawn as ServerDown by ErrorExplanation.
 */
export const SERVER_DOWN_MESSAGE: string =
  "Error connecting to server. Please try again in few minutes.";

/*
 * The English sentences that travel, one per kind: each says what happened
 * and what to do next, in one string, for every place that shows a message
 * as text.
 */
export const UNEXPLAINED_ERROR_MESSAGES: {
  serverWithReference: string;
  server: string;
  unreachable: string;
  page: string;
} = {
  serverWithReference: translationKey(
    "The server ran into a problem it could not explain, so this did not finish. Try again, and if it keeps failing, give this reference to your administrator or OneUptime support: {{reference}}.",
  ),
  server: translationKey(
    "The server ran into a problem it could not explain, so this did not finish. Try again in a moment.",
  ),
  unreachable: translationKey(
    "OneUptime could not be reached, so this did not finish. Check your internet connection, then try again.",
  ),
  page: translationKey(
    "This page ran into a problem, so this did not finish. Reload the page, then try again.",
  ),
};

/*
 * The same, in parts, for ErrorExplanation: what happened (unless the page
 * says what it was doing: "The monitor was not saved."), why, and what to
 * do next - with the reference after it, and, for the person who runs a
 * self-hosted server, where to look.
 */
export const UnexplainedErrorWords: {
  didNotFinish: string;
  serverWhy: string;
  serverDownWhy: string;
  unreachableWhy: string;
  pageWhy: string;
  serverNextWithReferenceCloud: string;
  serverNextWithReferenceSelfHosted: string;
  serverNext: string;
  serverDownNext: string;
  unreachableNext: string;
  pageNext: string;
  adminWhereToLookWithReference: string;
  adminWhereToLook: string;
  serverDownWhereToLook: string;
  openHealth: string;
  // What a page was doing, for the first line.
  createFailed: string;
  saveFailed: string;
  loadFailed: string;
  pageDidNotLoadTitle: string;
} = {
  didNotFinish: translationKey("This did not finish."),
  serverWhy: translationKey(
    "The server ran into a problem it could not explain.",
  ),
  serverDownWhy: translationKey("The OneUptime server did not answer."),
  unreachableWhy: translationKey("OneUptime could not be reached."),
  pageWhy: translationKey("This page ran into a problem."),
  serverNextWithReferenceCloud: translationKey(
    "Try again. If it keeps failing, contact OneUptime support and give them this reference:",
  ),
  serverNextWithReferenceSelfHosted: translationKey(
    "Try again. If it keeps failing, give this reference to whoever runs your OneUptime server:",
  ),
  serverNext: translationKey("Try again in a moment."),
  serverDownNext: translationKey(
    "It may be starting or restarting. Try again in a few minutes.",
  ),
  unreachableNext: translationKey(
    "Check your internet connection, then try again.",
  ),
  pageNext: translationKey("Reload the page, then try again."),
  // For a master admin of a self-hosted server.
  adminWhereToLookWithReference: translationKey(
    "To see what failed, run npm run doctor -- --logs in the server's oneuptime folder and look for this reference.",
  ),
  adminWhereToLook: translationKey(
    "To see what failed, run npm run doctor -- --logs in the server's oneuptime folder.",
  ),
  // For anyone on a self-hosted server: who installed it may not be signed in.
  serverDownWhereToLook: translationKey(
    "If you run this server, run npm run doctor in its oneuptime folder: it checks every container and shows the logs of any that is not running.",
  ),
  openHealth: translationKey("Open OneUptime Health"),
  createFailed: translationKey("The {{itemName}} was not created."),
  saveFailed: translationKey("The {{itemName}} was not saved."),
  loadFailed: translationKey("The {{itemName}} could not be loaded."),
  pageDidNotLoadTitle: translationKey("Page Did Not Load"),
};

// The server's answer for a failure it could not explain, in English.
export const getUnexplainedServerErrorMessage: (
  reference: string | null | undefined,
) => string = (reference: string | null | undefined): string => {
  return isErrorReference(reference)
    ? fillTemplate(UNEXPLAINED_ERROR_MESSAGES.serverWithReference, {
        reference: reference,
      })
    : UNEXPLAINED_ERROR_MESSAGES.server;
};

export interface UnexplainedError {
  kind: UnexplainedErrorKind;
  // Only for ServerWithReference.
  reference: string | null;
}

// The words before and after {{reference}} in the server's sentence.
const REFERENCE_PLACEHOLDER: string = "{{reference}}";

const SERVER_WITH_REFERENCE_START: string =
  UNEXPLAINED_ERROR_MESSAGES.serverWithReference.substring(
    0,
    UNEXPLAINED_ERROR_MESSAGES.serverWithReference.indexOf(
      REFERENCE_PLACEHOLDER,
    ),
  );

const SERVER_WITH_REFERENCE_END: string =
  UNEXPLAINED_ERROR_MESSAGES.serverWithReference.substring(
    UNEXPLAINED_ERROR_MESSAGES.serverWithReference.indexOf(
      REFERENCE_PLACEHOLDER,
    ) + REFERENCE_PLACEHOLDER.length,
  );

/*
 * Which unexplained error a message is, read back from its English sentence,
 * or null for any other message - one the server or the page put into
 * words, which is shown as it is.
 */
export const readUnexplainedError: (
  message: string | undefined | null,
) => UnexplainedError | null = (
  message: string | undefined | null,
): UnexplainedError | null => {
  const text: string = (message || "").trim();

  if (!text) {
    return null;
  }

  if (text === UNEXPLAINED_ERROR_MESSAGES.server) {
    return { kind: UnexplainedErrorKind.Server, reference: null };
  }

  if (text === SERVER_DOWN_MESSAGE) {
    return { kind: UnexplainedErrorKind.ServerDown, reference: null };
  }

  if (text === UNEXPLAINED_ERROR_MESSAGES.unreachable) {
    return { kind: UnexplainedErrorKind.Unreachable, reference: null };
  }

  if (text === UNEXPLAINED_ERROR_MESSAGES.page) {
    return { kind: UnexplainedErrorKind.Page, reference: null };
  }

  if (
    text.length ===
      SERVER_WITH_REFERENCE_START.length +
        ERROR_REFERENCE_LENGTH +
        SERVER_WITH_REFERENCE_END.length &&
    text.startsWith(SERVER_WITH_REFERENCE_START) &&
    text.endsWith(SERVER_WITH_REFERENCE_END)
  ) {
    const reference: string = text.substring(
      SERVER_WITH_REFERENCE_START.length,
      SERVER_WITH_REFERENCE_START.length + ERROR_REFERENCE_LENGTH,
    );

    if (isErrorReference(reference)) {
      return {
        kind: UnexplainedErrorKind.ServerWithReference,
        reference: reference,
      };
    }
  }

  return null;
};

/*
 * Who reads an explanation: it decides what to do next and where to look.
 * A visitor of a status page or a public dashboard never chose OneUptime:
 * they are told to try again, and nothing about the server's logs or its
 * support.
 */
export interface UnexplainedErrorReader {
  // OneUptime Cloud (billing on), rather than a server somebody runs.
  isCloud: boolean;
  // A master admin, who on a self-hosted server can read its logs.
  isMasterAdmin: boolean;
  isVisitor?: boolean | undefined;
}

// Why it failed, what to do next and, for some readers, where to look.
export interface UnexplainedErrorExplanation {
  why: string;
  next: string;
  whereToLook: string | null;
}

/*
 * The English words (translation keys) for each kind, for the reader the
 * page has. ErrorExplanation draws them as a block of their own, and
 * ErrorSentence inside a sentence a card writes around them
 * (Common/UI/Utils/ErrorInSentence): one set of words for both.
 */
export const getExplanationWords: (
  data: {
    error: UnexplainedError;
  } & UnexplainedErrorReader,
) => UnexplainedErrorExplanation = (
  data: {
    error: UnexplainedError;
  } & UnexplainedErrorReader,
): UnexplainedErrorExplanation => {
  const isSelfHostedAdmin: boolean =
    !data.isCloud && data.isMasterAdmin && !data.isVisitor;

  switch (data.error.kind) {
    case UnexplainedErrorKind.ServerWithReference:
      return {
        why: UnexplainedErrorWords.serverWhy,
        next: data.isVisitor
          ? UnexplainedErrorWords.serverNext
          : data.isCloud
            ? UnexplainedErrorWords.serverNextWithReferenceCloud
            : UnexplainedErrorWords.serverNextWithReferenceSelfHosted,
        whereToLook: isSelfHostedAdmin
          ? UnexplainedErrorWords.adminWhereToLookWithReference
          : null,
      };
    case UnexplainedErrorKind.Server:
      return {
        why: UnexplainedErrorWords.serverWhy,
        next: UnexplainedErrorWords.serverNext,
        whereToLook: isSelfHostedAdmin
          ? UnexplainedErrorWords.adminWhereToLook
          : null,
      };
    case UnexplainedErrorKind.ServerDown:
      return {
        why: UnexplainedErrorWords.serverDownWhy,
        next: UnexplainedErrorWords.serverDownNext,
        whereToLook:
          data.isCloud || data.isVisitor
            ? null
            : UnexplainedErrorWords.serverDownWhereToLook,
      };
    case UnexplainedErrorKind.Unreachable:
      return {
        why: UnexplainedErrorWords.unreachableWhy,
        next: UnexplainedErrorWords.unreachableNext,
        whereToLook: null,
      };
    default:
      return {
        why: UnexplainedErrorWords.pageWhy,
        next: UnexplainedErrorWords.pageNext,
        whereToLook: null,
      };
  }
};
