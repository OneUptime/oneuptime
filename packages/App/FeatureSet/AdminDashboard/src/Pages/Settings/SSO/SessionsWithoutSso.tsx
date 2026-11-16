import {
  SESSIONS_WITHOUT_SSO_COPY,
  SESSIONS_WITHOUT_SSO_TEST_ID,
} from "./SsoSettingsCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  END_SESSIONS_WITHOUT_SSO_ROUTE,
  readSessionsWithoutSsoAnswer,
  SESSIONS_WITHOUT_SSO_ROUTE,
  SessionsWithoutSsoAnswer,
} from "Common/Types/SSO/SessionsWithoutSso";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * PEOPLE STILL SIGNED IN WITHOUT SSO, under the Require SSO switch while it
 * is on (#6116).
 *
 * Requiring SSO keeps everyone but master admins out of every project until
 * they sign in with SSO, but it ends nobody's session: whoever signed in with
 * a password, a passkey or Sign in with Microsoft before stays signed in to
 * their account. So right after the switch is turned on - and whenever the
 * page is opened while it is on - this says how many people that is, and
 * offers to sign them out: after a dialog, every such session ends on the
 * server with its refresh token (GET and POST /global-config/sessions-
 * without-sso, Types/SSO/SessionsWithoutSso). Master admins are never among
 * them, so the admin making the change stays signed in. It then reads the
 * count again, and says nothing once nobody is left.
 *
 * Nothing is drawn while the count is being read, when it cannot be read,
 * or when nobody is signed in without SSO: a line that could only be wrong,
 * or say nothing new, is no help on a settings card.
 */

const COUNT_URL: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(
    new Route(SESSIONS_WITHOUT_SSO_ROUTE),
  );
};

const END_URL: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(
    new Route(END_SESSIONS_WITHOUT_SSO_ROUTE),
  );
};

const SessionsWithoutSso: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [isConfirmShown, setIsConfirmShown] = useState<boolean>(false);
  const [isSigningOut, setIsSigningOut] = useState<boolean>(false);
  const [signOutError, setSignOutError] = useState<string>("");

  const readCount: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.fetch<JSONObject>({
            method: HTTPMethod.GET,
            url: COUNT_URL(),
          });

        if (response instanceof HTTPErrorResponse || response.isFailure()) {
          setPeopleCount(null);
          return;
        }

        const answer: SessionsWithoutSsoAnswer | null =
          readSessionsWithoutSsoAnswer(response.data);

        setPeopleCount(answer ? answer.peopleCount : null);
      } catch {
        setPeopleCount(null);
      }
    }, []);

  useEffect(() => {
    void readCount();
  }, [readCount]);

  const signOut: () => Promise<void> = async (): Promise<void> => {
    setIsSigningOut(true);
    setSignOutError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: END_URL(),
          data: {},
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        setSignOutError(API.getFriendlyMessage(response));
        setIsSigningOut(false);
        return;
      }
    } catch (err) {
      setSignOutError(API.getFriendlyMessage(err));
      setIsSigningOut(false);
      return;
    }

    setIsSigningOut(false);
    setIsConfirmShown(false);
    await readCount();
  };

  if (!peopleCount) {
    return <></>;
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={SESSIONS_WITHOUT_SSO_TEST_ID}
    >
      <p
        className="text-sm text-gray-600"
        data-testid={`${SESSIONS_WITHOUT_SSO_TEST_ID}-count`}
      >
        {translator.translatePlural(
          SESSIONS_WITHOUT_SSO_COPY.stillSignedIn,
          peopleCount,
        )}
      </p>
      <div className="flex-none">
        <Button
          title={SESSIONS_WITHOUT_SSO_COPY.signOutButton}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          dataTestId={`${SESSIONS_WITHOUT_SSO_TEST_ID}-sign-out`}
          onClick={() => {
            setSignOutError("");
            setIsConfirmShown(true);
          }}
        />
      </div>
      {isConfirmShown ? (
        <ConfirmModal
          title={SESSIONS_WITHOUT_SSO_COPY.confirmTitle}
          description={SESSIONS_WITHOUT_SSO_COPY.confirmDescription}
          submitButtonText={SESSIONS_WITHOUT_SSO_COPY.signOutButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isSigningOut}
          error={signOutError || undefined}
          onClose={() => {
            setIsConfirmShown(false);
            setSignOutError("");
          }}
          onSubmit={() => {
            void signOut();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SessionsWithoutSso;
