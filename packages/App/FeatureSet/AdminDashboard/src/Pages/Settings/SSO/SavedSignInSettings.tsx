import {
  SAVED_SIGN_IN_SETTINGS_COPY,
  SAVED_SIGN_IN_SETTINGS_TEST_ID,
} from "./SsoSettingsCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import {
  CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE,
  ClearSavedSignInSettingsAnswer,
  readClearSavedSignInSettingsAnswer,
  readSavedSignInSettingsAnswer,
  SAVED_SIGN_IN_SETTINGS_ROUTE,
  SavedSignInSettingsAnswer,
} from "Common/Types/SSO/LocalSignInClearing";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import Toast from "Common/UI/Utils/Toast";
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
 * SIGN-IN SETTINGS PEOPLE SAVED BEFORE SSO WAS REQUIRED, under the Require
 * SSO switch while it is on (#9762), after the people still signed in
 * without SSO.
 *
 * While the server requires SSO, nobody but a master admin can set a
 * password, a passkey or two-factor authentication - but what they saved
 * before is kept, unused: it signs them in again the moment the requirement
 * is turned off, which an identity provider that has since removed someone
 * knows nothing about. So this says how many people the requirement covers
 * still have any (GET /global-config/saved-sign-in-settings,
 * Types/SSO/LocalSignInClearing), and offers to clear them all: after a
 * dialog that says it cannot be undone, their passwords, passkeys, security
 * keys, authenticator apps and backup codes are deleted and two-factor
 * authentication turned off, each person recorded in their projects' audit
 * logs. Master admins are never counted or cleared. It then reads the count
 * again, and says nothing once nobody is left.
 *
 * Nothing is drawn while the count is being read, when it cannot be read,
 * or when nobody has anything saved: a line that could only be wrong, or say
 * nothing new, is no help on a settings card.
 */

const COUNT_URL: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(
    new Route(SAVED_SIGN_IN_SETTINGS_ROUTE),
  );
};

const CLEAR_URL: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(
    new Route(CLEAR_SAVED_SIGN_IN_SETTINGS_ROUTE),
  );
};

const SavedSignInSettings: FunctionComponent = (): ReactElement => {
  const translator: Translator = useTranslator();

  const [peopleCount, setPeopleCount] = useState<number | null>(null);
  const [isConfirmShown, setIsConfirmShown] = useState<boolean>(false);
  const [isClearing, setIsClearing] = useState<boolean>(false);
  const [clearError, setClearError] = useState<string>("");

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

        const answer: SavedSignInSettingsAnswer | null =
          readSavedSignInSettingsAnswer(response.data);

        setPeopleCount(answer ? answer.peopleCount : null);
      } catch {
        setPeopleCount(null);
      }
    }, []);

  useEffect(() => {
    void readCount();
  }, [readCount]);

  const clear: () => Promise<void> = async (): Promise<void> => {
    setIsClearing(true);
    setClearError("");

    let answer: ClearSavedSignInSettingsAnswer | null = null;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post({
          url: CLEAR_URL(),
          data: {},
        });

      if (response instanceof HTTPErrorResponse || response.isFailure()) {
        setClearError(API.getFriendlyMessage(response));
        setIsClearing(false);
        return;
      }

      answer = readClearSavedSignInSettingsAnswer(response.data);
    } catch (err) {
      setClearError(API.getFriendlyMessage(err));
      setIsClearing(false);
      return;
    }

    setIsClearing(false);
    setIsConfirmShown(false);

    // Said only when the server said how many: never a count it did not give.
    if (answer) {
      Toast.success(
        translator.translatePlural(
          SAVED_SIGN_IN_SETTINGS_COPY.cleared,
          answer.peopleCleared,
        ),
      );
    }

    await readCount();
  };

  if (!peopleCount) {
    return <></>;
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={SAVED_SIGN_IN_SETTINGS_TEST_ID}
    >
      <p
        className="text-sm text-gray-600"
        data-testid={`${SAVED_SIGN_IN_SETTINGS_TEST_ID}-count`}
      >
        {translator.translatePlural(
          SAVED_SIGN_IN_SETTINGS_COPY.stillSaved,
          peopleCount,
        )}
      </p>
      <div className="flex-none">
        <Button
          title={SAVED_SIGN_IN_SETTINGS_COPY.clearButton}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          dataTestId={`${SAVED_SIGN_IN_SETTINGS_TEST_ID}-clear`}
          onClick={() => {
            setClearError("");
            setIsConfirmShown(true);
          }}
        />
      </div>
      {isConfirmShown ? (
        <ConfirmModal
          title={SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle}
          description={SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription}
          submitButtonText={SAVED_SIGN_IN_SETTINGS_COPY.clearButton}
          submitButtonType={ButtonStyleType.DANGER}
          isLoading={isClearing}
          error={clearError || undefined}
          onClose={() => {
            setIsConfirmShown(false);
            setClearError("");
          }}
          onSubmit={() => {
            void clear();
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default SavedSignInSettings;
