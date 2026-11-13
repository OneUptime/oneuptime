import CopyTextButton from "../CopyTextButton/CopyTextButton";
import Link from "../Link/Link";
import { ADMIN_DASHBOARD_URL, BILLING_ENABLED } from "../../Config";
import NewVersion, {
  NewVersionAudience,
} from "../../Utils/NewVersion/NewVersion";
import { Translator } from "../../Utils/TranslateTemplate";
import User from "../../Utils/User";
import useTranslator from "../../Utils/UseTranslator";
import URL from "../../../Types/API/URL";
import {
  readUnexplainedError,
  UnexplainedError,
  UnexplainedErrorKind,
  UnexplainedErrorWords,
} from "../../../Types/Exception/UnexplainedError";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * An error nobody explained, as a person should read it (#6836): what
 * failed, why as far as anyone knows, what to do next, and - when the server
 * failed - the reference to give to whoever can look into it, with a copy
 * button. A master admin of a self-hosted server also reads where to look;
 * on a gateway's error, so does anyone on a self-hosted server, since who
 * installed it may not be signed in yet (#1741).
 *
 * The shared places an error is drawn - a form's alert, a list that did not
 * load, the Error dialogs, the page that did not load - draw a message with
 * this when isUnexplainedErrorMessage says it is one of the sentences
 * API.getFriendlyMessage writes for these errors
 * (Common/Types/Exception/UnexplainedError), and draw every other message as
 * they always did.
 */

export interface ComponentProps {
  // A sentence API.getFriendlyMessage wrote (isUnexplainedErrorMessage).
  message: string;
  /*
   * What the page was doing, already in the reader's language: "The monitor
   * was not saved." Without it the first line says "This did not finish."
   */
  whatFailed?: string | undefined;
  /*
   * Leave the first line out where a title above already says what failed
   * ("Page Did Not Load").
   */
  hideWhatFailed?: boolean | undefined;
}

// Whether the message is one this draws, rather than words of their own.
export const isUnexplainedErrorMessage: (message: unknown) => boolean = (
  message: unknown,
): boolean => {
  return typeof message === "string" && readUnexplainedError(message) !== null;
};

interface Explanation {
  why: string;
  next: string;
  whereToLook: string | null;
}

/*
 * The words for each kind, for the reader the page has. A visitor of a
 * status page or a public dashboard never chose OneUptime: they are told
 * to try again, and nothing about the server's logs or its support.
 */
export const getExplanationWords: (data: {
  error: UnexplainedError;
  isCloud: boolean;
  isMasterAdmin: boolean;
  isVisitor?: boolean | undefined;
}) => Explanation = (data: {
  error: UnexplainedError;
  isCloud: boolean;
  isMasterAdmin: boolean;
  isVisitor?: boolean | undefined;
}): Explanation => {
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

const ErrorExplanation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const say: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const error: UnexplainedError | null = readUnexplainedError(props.message);

  if (!error) {
    // Not one of these: the message as it came, in the reader's language.
    return <>{say(props.message)}</>;
  }

  const isMasterAdmin: boolean = Boolean(User.isMasterAdmin());

  // A status page's or a public dashboard's reader (NewVersion's audience).
  const isVisitor: boolean =
    NewVersion.getAudience() === NewVersionAudience.Visitors;

  const words: Explanation = getExplanationWords({
    error: error,
    isCloud: BILLING_ENABLED,
    isMasterAdmin: isMasterAdmin,
    isVisitor: isVisitor,
  });

  // OneUptime Health answers only while the server does.
  const showHealthLink: boolean =
    !BILLING_ENABLED &&
    !isVisitor &&
    isMasterAdmin &&
    (error.kind === UnexplainedErrorKind.ServerWithReference ||
      error.kind === UnexplainedErrorKind.Server);

  return (
    <span className="block" data-testid="error-explanation">
      {!props.hideWhatFailed && (
        <span
          className="mb-1 block font-medium"
          data-testid="error-what-failed"
        >
          {props.whatFailed || say(UnexplainedErrorWords.didNotFinish)}
        </span>
      )}
      <span className="block" data-testid="error-why-and-next">
        {`${say(words.why)} ${say(words.next)}`}
      </span>
      {error.reference && (
        <span
          className="mt-2 flex flex-wrap items-center gap-2"
          data-testid="error-reference"
        >
          <code
            dir="ltr"
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-900"
          >
            {error.reference}
          </code>
          <CopyTextButton textToBeCopied={error.reference} size="sm" />
        </span>
      )}
      {words.whereToLook && (
        <span className="mt-2 block" data-testid="error-where-to-look">
          {say(words.whereToLook)}
          {showHealthLink && (
            <>
              {" "}
              <Link
                className="underline"
                to={URL.fromString(ADMIN_DASHBOARD_URL.toString()).addRoute(
                  "/health",
                )}
                dataTestId="error-open-health"
              >
                {say(UnexplainedErrorWords.openHealth)}
              </Link>
            </>
          )}
        </span>
      )}
    </span>
  );
};

export default ErrorExplanation;
