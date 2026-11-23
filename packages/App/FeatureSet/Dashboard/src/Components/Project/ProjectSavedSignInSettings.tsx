import {
  PROJECT_SAVED_SIGN_IN_SETTINGS_COPY,
  PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID,
} from "./ProjectSavedSignInSettingsCopy";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  ClearSavedSignInSettingsAnswer,
  getProjectClearSavedSignInSettingsRoute,
  getProjectSavedSignInSettingsRoute,
  readClearSavedSignInSettingsAnswer,
  readSavedSignInSettingsAnswer,
  SavedSignInSettingsAnswer,
} from "Common/Types/SSO/LocalSignInClearing";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
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
 * SIGN-IN SETTINGS A PROJECT'S PEOPLE SAVED BEFORE IT MANAGED SIGN-IN WITH
 * SSO, under Manage Sign-In with SSO while it is on (#9820).
 *
 * Someone whose every project manages sign-in with SSO gets no new password,
 * passkey or second step - but keeps what they saved before, unused by
 * their projects, and working again the day the switch goes off. So this
 * tells the project's owner how many of its people still have any
 * (GET /project/:id/saved-sign-in-settings) - only people whose every
 * project is one this owner owns, so the organization never decides about
 * an account somebody uses elsewhere - and offers to clear them: after a
 * dialog that says it cannot be undone, their passwords, passkeys, security
 * keys, authenticator apps and backup codes are deleted, two-factor
 * authentication is turned off, each is recorded in the audit log and
 * emailed. It then reads the count again, and says nothing once nobody is
 * left.
 *
 * The server clears only once the owner's session has confirmed it's
 * theirs (#10775): until then it refuses the clear, changing nothing, and
 * the Dashboard's API client asks them (Confirm It's You, mounted in
 * App.tsx) and sends the same clear again once they have, while the dialog
 * waits. Cancelled, the dialog says why nothing was cleared.
 *
 * Nothing is drawn while the count is being read, when it cannot be read -
 * the server answers only the project's owners - or when nobody has
 * anything saved: a line that could only be wrong, or say nothing new, is
 * no help on a settings card.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

const ProjectSavedSignInSettings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
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
            url: URL.fromURL(APP_API_URL).addRoute(
              new Route(
                getProjectSavedSignInSettingsRoute(props.projectId.toString()),
              ),
            ),
            headers: ModelAPI.getCommonHeaders(),
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
    }, [props.projectId]);

  useEffect(() => {
    void readCount();
  }, [readCount]);

  const clear: () => Promise<void> = async (): Promise<void> => {
    setIsClearing(true);
    setClearError("");

    let answer: ClearSavedSignInSettingsAnswer | null = null;

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromURL(APP_API_URL).addRoute(
            new Route(
              getProjectClearSavedSignInSettingsRoute(
                props.projectId.toString(),
              ),
            ),
          ),
          data: {},
          headers: ModelAPI.getCommonHeaders(),
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
    if (answer && answer.peopleCleared > 0) {
      Toast.success(
        translator.translatePlural(
          PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.cleared,
          answer.peopleCleared,
        ),
      );
    } else if (answer) {
      /*
       * It cleared nobody: another clear of them came first (#10776), and
       * this one removed and recorded nothing. Said as what it is, never as
       * a clear of 0 people.
       */
      Toast.info(
        translator.translateText(
          PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared,
        ) || PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.alreadyCleared,
      );
    }

    await readCount();
  };

  if (!peopleCount) {
    return <></>;
  }

  return (
    <div
      className="mt-4 flex flex-col gap-3 rounded-md border border-gray-200 p-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid={PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID}
    >
      <p
        className="text-sm text-gray-600"
        data-testid={`${PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID}-count`}
      >
        {translator.translatePlural(
          PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.stillSaved,
          peopleCount,
        )}
      </p>
      <div className="flex-none">
        <Button
          title={PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.clearButton}
          buttonStyle={ButtonStyleType.DANGER_OUTLINE}
          dataTestId={`${PROJECT_SAVED_SIGN_IN_SETTINGS_TEST_ID}-clear`}
          onClick={() => {
            setClearError("");
            setIsConfirmShown(true);
          }}
        />
      </div>
      {isConfirmShown ? (
        <ConfirmModal
          title={PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmTitle}
          description={PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.confirmDescription}
          submitButtonText={PROJECT_SAVED_SIGN_IN_SETTINGS_COPY.clearButton}
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

export default ProjectSavedSignInSettings;
