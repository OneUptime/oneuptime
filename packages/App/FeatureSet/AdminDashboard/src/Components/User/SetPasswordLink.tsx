import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { SET_PASSWORD_LINK_EXPIRY_DAYS } from "Common/Types/Accounts/SetPasswordLink";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import CopyTextButton from "Common/UI/Components/CopyTextButton/CopyTextButton";
import ErrorSentence from "Common/UI/Components/ErrorMessage/ErrorSentence";
import Link from "Common/UI/Components/Link/Link";
import Modal from "Common/UI/Components/Modal/Modal";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

/*
 * HOW A USER CREATED IN THE ADMIN DASHBOARD GETS THEIR FIRST PASSWORD (#9139).
 *
 * Users > Create User asks for a name and an email. Unless the master admin
 * sets a password under More fields, OneUptime emails the new user a link to
 * choose their own (POST /user/:userId/send-password-reset-link, which sends
 * a set-password link to an account with no password:
 * Common/Types/Accounts/SetPasswordLink). The admin never invents a password
 * and never has to pass one on.
 *
 * When that email is not sent - the server has no email set up, or the mail
 * server refused it - the user still exists, and the admin is shown why in
 * OneUptime's words first and the mail server's second, with the link the
 * email would have carried (POST /user/:userId/set-password-link) to copy
 * and send themselves, or the way to set a password for them instead.
 */

// What the page says when the email was not sent: the reason goes in {{error}}.
export const SET_PASSWORD_EMAIL_NOT_SENT: string = translationKey(
  "{{name}} was created, but the email with a link to set their password was not sent. {{error}}",
);

// When the link to copy could not be made either.
export const SET_PASSWORD_LINK_NOT_MADE: string = translationKey(
  "The link to send them yourself was not made either. {{error}}",
);

// What the fold holding the password says it will do, folded.
export const PASSWORD_FOLD_SUMMARY_EMAIL: string = translationKey(
  "OneUptime emails them a link to set their own password.",
);
export const PASSWORD_FOLD_SUMMARY_PASSWORD: string = translationKey(
  "They sign in with the password you set. Share it with them securely.",
);

// The password field's help on a server that cannot send email yet.
export const PASSWORD_HELP_NO_EMAIL: string = translationKey(
  "This server cannot send email yet. Set their password here, or leave it empty to get a link to send them yourself.",
);

const userRoute: (userId: ObjectID, action: string) => URL = (
  userId: ObjectID,
  action: string,
): URL => {
  return URL.fromString(APP_API_URL.toString()).addRoute(
    `/user/${userId.toString()}/${action}`,
  );
};

export type SetPasswordEmailResult =
  | { isSent: true; email: string }
  | { isSent: false; error: string };

/*
 * Emails a user with no password a link to set it. Never throws: what the
 * page says next depends on whether it went.
 */
export const sendSetPasswordEmail: (
  userId: ObjectID,
) => Promise<SetPasswordEmailResult> = async (
  userId: ObjectID,
): Promise<SetPasswordEmailResult> => {
  try {
    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.post<JSONObject>({
        url: userRoute(userId, "send-password-reset-link"),
        data: {},
      });

    // API.post resolves a refusal rather than rejecting.
    if (response instanceof HTTPErrorResponse) {
      return { isSent: false, error: API.getFriendlyMessage(response) };
    }

    const email: unknown = (response.data as JSONObject)?.["email"];

    return { isSent: true, email: typeof email === "string" ? email : "" };
  } catch (err) {
    return { isSent: false, error: API.getFriendlyMessage(err) };
  }
};

export interface ComponentProps {
  userId: ObjectID;
  // The new user's name and email, as the form had them.
  name: string;
  email: string;
  // Why the email was not sent: API.getFriendlyMessage's answer.
  error: string;
  onClose: () => void;
}

const SetPasswordLinkModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const [link, setLink] = useState<string>("");
  const [linkError, setLinkError] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(true);

  /*
   * Made as the dialog opens: the admin is here to send it. It replaces any
   * link made before, works once, and expires on its own if never sent.
   */
  useEffect(() => {
    let isCurrent: boolean = true;

    API.post<JSONObject>({
      url: userRoute(props.userId, "set-password-link"),
      data: {},
    })
      .then((response: HTTPResponse<JSONObject> | HTTPErrorResponse) => {
        if (!isCurrent) {
          return;
        }

        const made: unknown =
          response instanceof HTTPErrorResponse
            ? undefined
            : (response.data as JSONObject)?.["link"];

        if (typeof made === "string" && made) {
          setLink(made);
        } else {
          setLinkError(API.getFriendlyMessage(response));
        }

        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (isCurrent) {
          setLinkError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [props.userId.toString()]);

  const authenticationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.USER_AUTHENTICATION] as Route,
    { modelId: props.userId },
  );

  return (
    <Modal
      title={t("pages.users.setPasswordLinkTitle")}
      isTitleTranslated={true}
      isBodyLoading={isLoading}
      // A notice: one plain way out, nothing more to do here.
      closeButtonText="Done"
      onClose={props.onClose}
    >
      <div className="space-y-4" data-testid="set-password-link-dialog">
        <div
          className="text-sm text-gray-700 text-pretty"
          data-testid="set-password-email-not-sent"
        >
          <ErrorSentence
            template={SET_PASSWORD_EMAIL_NOT_SENT}
            values={{ name: props.name || props.email }}
            error={props.error}
          />
        </div>

        {link ? (
          <>
            <p className="text-sm text-gray-600 text-pretty">
              {t("pages.users.setPasswordLinkDescription", {
                email: props.email,
                days: SET_PASSWORD_LINK_EXPIRY_DAYS,
              })}
            </p>
            <div
              className="flex items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2"
              data-testid="set-password-link"
            >
              <code
                className="min-w-0 flex-1 break-all text-sm text-gray-800"
                data-testid="set-password-link-value"
              >
                {link}
              </code>
              <CopyTextButton textToBeCopied={link} size="sm" variant="soft" />
            </div>
          </>
        ) : (
          <></>
        )}

        {linkError ? (
          <div
            className="text-sm text-gray-600 text-pretty"
            data-testid="set-password-link-failed"
          >
            <ErrorSentence
              template={SET_PASSWORD_LINK_NOT_MADE}
              error={linkError}
            />
          </div>
        ) : (
          <></>
        )}

        <p className="text-sm text-pretty">
          <Link
            to={authenticationRoute}
            className="font-medium text-indigo-600 underline hover:text-indigo-700"
            dataTestId="set-password-link-authentication-page"
          >
            {t("pages.users.setPasswordLinkOrSetIt")}
          </Link>
        </p>
      </div>
    </Modal>
  );
};

export default SetPasswordLinkModal;
