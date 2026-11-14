import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentVariable,
} from "Common/Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfigUses, {
  TwilioConfigUse,
} from "Common/Types/CallAndSMS/TwilioConfigUse";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import FieldType from "Common/UI/Components/Types/FieldType";
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
 * THE SERVER'S TWILIO ACCOUNT, WHEN ENVIRONMENT VARIABLES SET IT (#7515).
 *
 * Once GLOBAL_TWILIO_ACCOUNT_SID is set - twilio in the Helm chart's values,
 * or config.env with Docker Compose - the server sends through the account
 * the GLOBAL_TWILIO_ variables describe, and the account saved on this page
 * is not used (Common/Types/CallAndSMS/ServerTwilioEnvironment). So Settings
 * > Call and SMS shows that account in place of the saved one: the same
 * card title and fields, each with the variable that sets it, and no Edit
 * button, since the server refuses a write to it. What is wrong with the
 * variables is said above the fields, by the variable's name: the account
 * sends nothing until it is fixed.
 *
 * Variables set without GLOBAL_TWILIO_ACCOUNT_SID are read by nothing: the
 * saved account and its Edit button stay, under a warning that names them.
 *
 * The server says which it is (GET /global-config/twilio-environment), never
 * with the auth token: only whether one is set.
 */

export const SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID: string =
  "server-twilio-environment-card";

export const SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID: string =
  "server-twilio-environment-unused";

export const SERVER_TWILIO_ENVIRONMENT_LOADING_TEST_ID: string =
  "server-twilio-environment-loading";

export interface UseServerTwilioEnvironmentResult {
  isLoading: boolean;
  // Null when the server could not say: the page then shows the saved account.
  answer: ServerTwilioEnvironmentAnswer | null;
}

export const useServerTwilioEnvironment: () => UseServerTwilioEnvironmentResult =
  (): UseServerTwilioEnvironmentResult => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [answer, setAnswer] = useState<ServerTwilioEnvironmentAnswer | null>(
      null,
    );

    useEffect(() => {
      let isCancelled: boolean = false;

      const load: () => Promise<void> = async (): Promise<void> => {
        let read: ServerTwilioEnvironmentAnswer | null = null;

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.fetch<JSONObject>({
              method: HTTPMethod.GET,
              url: URL.fromURL(APP_API_URL).addRoute(
                new Route(SERVER_TWILIO_ENVIRONMENT_ROUTE),
              ),
            });

          if (
            !(response instanceof HTTPErrorResponse) &&
            response.isSuccess()
          ) {
            read = ServerTwilioEnvironment.answerFromJSON(response.data);
          }
        } catch {
          // The saved account is shown, and the server still refuses a wrong write.
          read = null;
        }

        if (!isCancelled) {
          setAnswer(read);
          setIsLoading(false);
        }
      };

      void load();

      return () => {
        isCancelled = true;
      };
    }, []);

    return { isLoading: isLoading, answer: answer };
  };

// The account as the card's fields read it.
interface EnvironmentAccountItem {
  usedFor: TwilioConfigUse;
  accountSid: string;
  authToken: string;
  primaryPhoneNumber: string;
  smsPhoneNumbers: string;
  secondaryPhoneNumbers: string;
}

// What is wrong with the variables, one line each, under the title the alert gives it.
const ProblemList: FunctionComponent<{ problems: Array<string> }> = (props: {
  problems: Array<string>;
}): ReactElement => {
  return (
    <ul className="mt-1 list-disc ps-5">
      {props.problems.map((problem: string, index: number) => {
        /*
         * The server's line, in English, by the variables' names: in a
         * right-to-left language it keeps its own direction, its full stop
         * at its end - not drawn first, before GLOBAL_TWILIO_ (#7804).
         */
        return (
          <li key={index}>
            <bdi>{problem}</bdi>
          </li>
        );
      })}
    </ul>
  );
};

/*
 * Above the saved account, when variables are set without
 * GLOBAL_TWILIO_ACCOUNT_SID: nothing reads them, so the saved account is
 * the one that sends. Nothing when no variable is set.
 */
export const ServerTwilioEnvironmentUnusedAlert: FunctionComponent<{
  answer: ServerTwilioEnvironmentAnswer | null;
}> = (props: {
  answer: ServerTwilioEnvironmentAnswer | null;
}): ReactElement => {
  const { t } = useTranslation();

  if (
    !props.answer ||
    props.answer.isSetByEnvironment ||
    props.answer.problems.length === 0
  ) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.WARNING}
      dataTestId={SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID}
      strongTitle={t("pages.settings.callSms.environmentUnusedTitle")}
      title={<ProblemList problems={props.answer.problems} />}
    />
  );
};

// While the server says whether the variables set the account.
export const ServerTwilioEnvironmentLoadingCard: FunctionComponent =
  (): ReactElement => {
    const { t } = useTranslation();

    return (
      <div data-testid={SERVER_TWILIO_ENVIRONMENT_LOADING_TEST_ID}>
        <Card
          title={t("pages.settings.callSms.cardTitle")}
          description={t("pages.settings.callSms.cardDescription")}
        >
          <ComponentLoader />
        </Card>
      </div>
    );
  };

export interface ComponentProps {
  answer: ServerTwilioEnvironmentAnswer;
}

const ServerTwilioEnvironmentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const answer: ServerTwilioEnvironmentAnswer = props.answer;

  const item: EnvironmentAccountItem = {
    usedFor: TwilioConfigUses.getUse(answer.usedFor),
    accountSid: answer.accountSid || "",
    authToken: answer.hasAuthToken ? "set" : "",
    primaryPhoneNumber: answer.primaryPhoneNumber || "",
    smsPhoneNumbers: answer.smsPhoneNumbers || "",
    secondaryPhoneNumbers: answer.secondaryPhoneNumbers || "",
  };

  return (
    <div data-testid={SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID}>
      <Card
        title={t("pages.settings.callSms.cardTitle")}
        description={t("pages.settings.callSms.environmentCardDescription")}
      >
        {/*
         * Under a rule across the card, as the saved account's fields are
         * (CardModelDetail), so the two read as the same card.
         */}
        <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
          {answer.problems.length > 0 ? (
            <Alert
              type={AlertType.DANGER}
              className="mb-5"
              strongTitle={t("pages.settings.callSms.environmentProblemsTitle")}
              title={<ProblemList problems={answer.problems} />}
            />
          ) : (
            <></>
          )}
          <Detail<EnvironmentAccountItem>
            id="server-twilio-environment-detail"
            item={item}
            fields={[
              {
                key: "usedFor",
                title: "Used For",
                description: ServerTwilioEnvironmentVariable.UsedFor,
                fieldType: FieldType.Element,
                getElement: (account: EnvironmentAccountItem): ReactElement => {
                  switch (account.usedFor) {
                    case TwilioConfigUse.SmsOnly:
                      return <span>{t("SMS only")}</span>;
                    case TwilioConfigUse.CallsOnly:
                      return <span>{t("Calls only")}</span>;
                    default:
                      return <span>{t("Calls and SMS")}</span>;
                  }
                },
              },
              {
                key: "accountSid",
                title: "Twilio Account SID",
                description: ServerTwilioEnvironmentVariable.AccountSid,
                /*
                 * As written in the variable, so Detail isolates it
                 * (IsolatedText) and it keeps its own direction in a
                 * right-to-left page, as the phone numbers keep theirs
                 * (PhoneNumberText). Used For and the auth token's Set are
                 * the page's own words, in the page's direction.
                 */
                placeholder: t("common.none"),
                isPlaceholderTranslated: true,
              },
              {
                key: "authToken",
                title: "Twilio Auth Token",
                description: ServerTwilioEnvironmentVariable.AuthToken,
                fieldType: FieldType.Element,
                // Never the token: whether the variable holds one.
                getElement: (account: EnvironmentAccountItem): ReactElement => {
                  return (
                    <span>
                      {account.authToken
                        ? t("pages.settings.callSms.authTokenSet")
                        : t("pages.settings.callSms.authTokenNotSet")}
                    </span>
                  );
                },
              },
              {
                key: "primaryPhoneNumber",
                title: "Twilio Primary Phone Number",
                description: ServerTwilioEnvironmentVariable.PrimaryPhoneNumber,
                fieldType: FieldType.Phone,
                placeholder: t("common.none"),
                isPlaceholderTranslated: true,
                // An account used for SMS only makes no calls, from any number.
                showIf: (account: EnvironmentAccountItem): boolean => {
                  return TwilioConfigUses.makesCalls(account.usedFor);
                },
              },
              {
                key: "smsPhoneNumbers",
                title: "Twilio SMS Phone Numbers",
                description: ServerTwilioEnvironmentVariable.SmsPhoneNumbers,
                fieldType: FieldType.Phone,
                // Without them, SMS go out from the numbers calls do.
                placeholder: t("pages.settings.callSms.smsSameAsCalls"),
                isPlaceholderTranslated: true,
                showIf: (account: EnvironmentAccountItem): boolean => {
                  return TwilioConfigUses.sendsSms(account.usedFor);
                },
              },
              {
                key: "secondaryPhoneNumbers",
                title: "Twilio Secondary Phone Numbers",
                description:
                  ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers,
                fieldType: FieldType.Phone,
                placeholder: t("common.none"),
                isPlaceholderTranslated: true,
                showIf: (account: EnvironmentAccountItem): boolean => {
                  return TwilioConfigUses.makesCalls(account.usedFor);
                },
              },
            ]}
          />
        </div>
      </Card>
    </div>
  );
};

export default ServerTwilioEnvironmentCard;
