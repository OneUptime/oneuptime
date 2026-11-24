import AppLink from "../AppLink/AppLink";
import {
  ERASED_ON_REQUEST,
  ERASED_ON_REQUEST_DETAIL,
  HASHED_IN_YOUR_LOGS,
  HASHED_IN_YOUR_TRACES,
  SEARCH_YOUR_LOGS_FOR,
  SEARCH_YOUR_TRACES_FOR,
} from "./HiddenUserCopy";
import { HashedEventUser } from "./SecurityEventDetailFields";
import {
  HashedUserSearch,
  HashedUserSignal,
  getHashedUserSearch,
} from "./SecurityEventTelemetryLinks";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export const HASHED_USER_TEST_ID: string = "security-hashed-user";
export const ERASED_USER_TEST_ID: string = "security-erased-user";

export interface ComponentProps {
  // The user as the event names them.
  user: string;
  hashedUser?: HashedEventUser | undefined;
  isErasedUser?: boolean | undefined;
}

/*
 * PRINCIPAL USER OR TARGET USER, WITH WHAT THE RECORDS HOLD (#10909).
 *
 * When Security Events named the user behind a Hash rule's token (its user
 * vault, #10632), the logs or traces hold only the token, so a search for
 * "alice@example.com" there finds nothing. Under the user, a line says what
 * they hold - "Hashed in your logs as [HASHED:5e29db14e508e09a]" - the token
 * a link that searches them for it, around the event (getHashedUserSearch).
 *
 * When an erasure request took the person out of Security Events (#10908),
 * the user is the token again, and the line under it says so: "Erased on
 * request". Neither line ever names who the token stands for.
 */
const EventUserText: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const search: HashedUserSearch | null = props.hashedUser
    ? getHashedUserSearch(props.hashedUser)
    : null;
  const isTrace: boolean = search?.signal === HashedUserSignal.Trace;

  return (
    <span className="block min-w-0">
      <span className="[overflow-wrap:anywhere]">{props.user}</span>
      {search ? (
        <span
          data-testid={HASHED_USER_TEST_ID}
          className="mt-0.5 block text-xs text-gray-500"
        >
          <TranslatedSentence
            template={isTrace ? HASHED_IN_YOUR_TRACES : HASHED_IN_YOUR_LOGS}
            slots={{
              token: (
                <AppLink
                  to={search.route}
                  className="font-mono text-indigo-700 underline hover:text-indigo-900 [overflow-wrap:anywhere]"
                  title={translator.translateTemplate(
                    isTrace ? SEARCH_YOUR_TRACES_FOR : SEARCH_YOUR_LOGS_FOR,
                    { token: search.token },
                  )}
                >
                  <IsolatedText text={search.hashed} />
                </AppLink>
              ),
            }}
          />
        </span>
      ) : (
        <></>
      )}
      {props.isErasedUser ? (
        <span
          data-testid={ERASED_USER_TEST_ID}
          className="mt-0.5 block text-xs text-gray-500"
          title={
            translator.translateText(ERASED_ON_REQUEST_DETAIL) ||
            ERASED_ON_REQUEST_DETAIL
          }
        >
          {translator.translateText(ERASED_ON_REQUEST) || ERASED_ON_REQUEST}
        </span>
      ) : (
        <></>
      )}
    </span>
  );
};

export default EventUserText;
