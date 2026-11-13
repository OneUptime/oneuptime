import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import AmazonSesAuthenticationType from "Common/Types/Email/AmazonSesAuthenticationType";
import MailgunRegion from "Common/Types/Email/MailgunRegion";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ServerEmailEnvironment, {
  SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES,
  SERVER_EMAIL_ENVIRONMENT_ROUTE,
  SERVER_EMAIL_MAILGUN_REGION_VALUES,
  SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES,
  SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES,
  SERVER_EMAIL_SMTP_TRANSPORT_VALUES,
  ServerEmailEnvironmentAnswer,
  ServerEmailEnvironmentField,
  ServerEmailEnvironmentVariable,
  ServerEmailSmtpTransport,
} from "Common/Types/Email/ServerEmailEnvironment";
import MailTransportType from "Common/Types/Email/MailTransportType";
import { JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import Detail from "Common/UI/Components/Detail/Detail";
import Field from "Common/UI/Components/Detail/Field";
import { CARD_MODEL_DETAIL_BODY_CLASS_NAME } from "Common/UI/Components/ModelDetail/CardModelDetail";
import {
  getAmazonSesAuthenticationTypeTitle,
  SMTP_AUTH_TYPE_CHOICES,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import type { RadioButton } from "Common/UI/Components/RadioButtons/GroupRadioButtons";
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
 * THE SERVER'S EMAIL SETTINGS, WHEN ENVIRONMENT VARIABLES SET THEM (#7738).
 *
 * Once GLOBAL_EMAIL_SERVER_TYPE is set - email in the Helm chart's values,
 * or config.env with Docker Compose - the server sends with the settings
 * the GLOBAL_EMAIL_ variables describe, and the settings saved on this page
 * are not used (Common/Types/Email/ServerEmailEnvironment). So Settings >
 * Emails shows those settings in place of the saved ones: the same card
 * title and field names, each with the variable that sets it, and no Edit
 * button, since the server refuses a write to them. What is wrong with the
 * variables is said above the fields, by the variable's name: the server
 * sends no email until it is fixed. A variable the chosen settings do not
 * read is named too, as changing nothing.
 *
 * Variables set without GLOBAL_EMAIL_SERVER_TYPE are read by nothing: the
 * saved settings and their Edit buttons stay, under a warning that names
 * them.
 *
 * The server says which it is (GET /global-config/email-environment), never
 * with a password or a key: only whether each is set.
 */

export const SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID: string =
  "server-email-environment-card";

export const SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID: string =
  "server-email-environment-unused";

export const SERVER_EMAIL_ENVIRONMENT_IGNORED_TEST_ID: string =
  "server-email-environment-ignored";

export const SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID: string =
  "server-email-environment-loading";

/*
 * The name each variable's field has on this page's saved cards, so the
 * two read alike. Every one is a title the Admin Dashboard already shows,
 * in each of its languages.
 */
export const SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES: Readonly<
  Record<ServerEmailEnvironmentVariable, string>
> = {
  [ServerEmailEnvironmentVariable.ServerType]: "Email Server Type",
  [ServerEmailEnvironmentVariable.FromEmail]: "From Email",
  [ServerEmailEnvironmentVariable.FromName]: "From Name",
  [ServerEmailEnvironmentVariable.SmtpTransport]: "Transport",
  [ServerEmailEnvironmentVariable.SmtpHost]: "SMTP Host",
  [ServerEmailEnvironmentVariable.SmtpPort]: "SMTP Port",
  [ServerEmailEnvironmentVariable.SmtpRequireTls]: "Require TLS",
  [ServerEmailEnvironmentVariable.SmtpAuthType]: "Authentication Type",
  [ServerEmailEnvironmentVariable.SmtpUsername]: "Username",
  [ServerEmailEnvironmentVariable.SmtpPassword]: "Password",
  [ServerEmailEnvironmentVariable.SmtpOAuthProviderType]: "OAuth Provider Type",
  [ServerEmailEnvironmentVariable.SmtpOAuthClientId]: "OAuth Client ID",
  [ServerEmailEnvironmentVariable.SmtpOAuthClientSecret]: "OAuth Client Secret",
  [ServerEmailEnvironmentVariable.SmtpOAuthTokenUrl]: "OAuth Token URL",
  [ServerEmailEnvironmentVariable.SmtpOAuthScope]: "OAuth Scope",
  [ServerEmailEnvironmentVariable.SendgridApiKey]: "SendGrid API Key",
  [ServerEmailEnvironmentVariable.AmazonSesAuthenticationType]:
    "Authentication Type",
  [ServerEmailEnvironmentVariable.AmazonSesAccessKeyId]: "Access Key ID",
  [ServerEmailEnvironmentVariable.AmazonSesSecretAccessKey]:
    "Secret Access Key",
  [ServerEmailEnvironmentVariable.AmazonSesRegion]: "Region",
  [ServerEmailEnvironmentVariable.MailgunApiKey]: "API Key",
  [ServerEmailEnvironmentVariable.MailgunDomain]: "Domain",
  [ServerEmailEnvironmentVariable.MailgunRegion]: "Region",
  [ServerEmailEnvironmentVariable.PostmarkServerToken]: "Server API Token",
  [ServerEmailEnvironmentVariable.ResendApiKey]: "API Key",
};

export interface UseServerEmailEnvironmentResult {
  isLoading: boolean;
  // Null when the server could not say: the page then shows the saved settings.
  answer: ServerEmailEnvironmentAnswer | null;
}

export const useServerEmailEnvironment: () => UseServerEmailEnvironmentResult =
  (): UseServerEmailEnvironmentResult => {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [answer, setAnswer] = useState<ServerEmailEnvironmentAnswer | null>(
      null,
    );

    useEffect(() => {
      let isCancelled: boolean = false;

      const load: () => Promise<void> = async (): Promise<void> => {
        let read: ServerEmailEnvironmentAnswer | null = null;

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.fetch<JSONObject>({
              method: HTTPMethod.GET,
              url: URL.fromURL(APP_API_URL).addRoute(
                new Route(SERVER_EMAIL_ENVIRONMENT_ROUTE),
              ),
            });

          if (
            !(response instanceof HTTPErrorResponse) &&
            response.isSuccess()
          ) {
            read = ServerEmailEnvironment.answerFromJSON(response.data);
          }
        } catch {
          // The saved settings are shown, and the server still refuses a wrong write.
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

// One line each, under the title the alert gives them.
const LineList: FunctionComponent<{ lines: Array<string> }> = (props: {
  lines: Array<string>;
}): ReactElement => {
  return (
    <ul className="mt-1 list-disc ps-5">
      {props.lines.map((line: string, index: number) => {
        /*
         * The server's line, in English, by the variables' names: in a
         * right-to-left language it keeps its own direction, its full stop
         * at its end.
         */
        return (
          <li key={index}>
            <bdi>{line}</bdi>
          </li>
        );
      })}
    </ul>
  );
};

/*
 * Above the saved settings, when variables are set without
 * GLOBAL_EMAIL_SERVER_TYPE: nothing reads them, so the saved settings are
 * the ones that send. Nothing when no variable is set.
 */
export const ServerEmailEnvironmentUnusedAlert: FunctionComponent<{
  answer: ServerEmailEnvironmentAnswer | null;
}> = (props: { answer: ServerEmailEnvironmentAnswer | null }): ReactElement => {
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
      dataTestId={SERVER_EMAIL_ENVIRONMENT_UNUSED_TEST_ID}
      strongTitle={t("pages.settings.email.environmentUnusedTitle")}
      title={<LineList lines={props.answer.problems} />}
    />
  );
};

// While the server says whether the variables set the email settings.
export const ServerEmailEnvironmentLoadingCard: FunctionComponent =
  (): ReactElement => {
    const { t } = useTranslation();

    return (
      <div data-testid={SERVER_EMAIL_ENVIRONMENT_LOADING_TEST_ID}>
        <Card
          title={t("pages.settings.email.serverCardTitle")}
          description={t("pages.settings.email.serverCardDescription")}
        >
          <ComponentLoader />
        </Card>
      </div>
    );
  };

// The variables' values, by variable, as the card's fields read them.
type EnvironmentSettingsItem = Partial<
  Record<ServerEmailEnvironmentVariable, string>
>;

export interface ComponentProps {
  answer: ServerEmailEnvironmentAnswer;
  /*
   * The Email Server Type as the saved card shows it - "SendGrid", or
   * "Custom SMTP" in the reader's language (Email/Index).
   */
  getServerTypeText: (value: unknown) => string;
}

const ServerEmailEnvironmentCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const answer: ServerEmailEnvironmentAnswer = props.answer;

  const item: EnvironmentSettingsItem = {};

  for (const field of answer.fields) {
    item[field.variable] = field.value || "";
  }

  // A choice as the setting reads it: what is written, or what it is when left empty.
  const choiceText: <T extends string>(
    field: ServerEmailEnvironmentField,
    values: Readonly<Record<T, string>>,
    defaultChoice: T,
    title: (choice: T) => string,
  ) => string = <T extends string>(
    field: ServerEmailEnvironmentField,
    values: Readonly<Record<T, string>>,
    defaultChoice: T,
    title: (choice: T) => string,
  ): string => {
    const choice: T | null = ServerEmailEnvironment.readChoice<T>(
      field.value || "",
      values,
      defaultChoice,
    );

    // Not one of the choices: as written, beside the problem that says so.
    return choice === null ? field.value || "" : title(choice);
  };

  const getValueText: (field: ServerEmailEnvironmentField) => string = (
    field: ServerEmailEnvironmentField,
  ): string => {
    // Never a password or a key: whether the variable holds one.
    if (field.isSecret) {
      return field.isSet
        ? t("pages.settings.email.environmentValueSet")
        : t("pages.settings.email.environmentValueNotSet");
    }

    switch (field.variable) {
      case ServerEmailEnvironmentVariable.ServerType:
        return answer.serverType
          ? props.getServerTypeText(answer.serverType)
          : field.value || "";

      case ServerEmailEnvironmentVariable.SmtpTransport:
        return choiceText<ServerEmailSmtpTransport>(
          field,
          SERVER_EMAIL_SMTP_TRANSPORT_VALUES,
          MailTransportType.SMTP,
          (choice: ServerEmailSmtpTransport): string => {
            return choice;
          },
        );

      case ServerEmailEnvironmentVariable.SmtpRequireTls: {
        const written: string = (field.value || "").toLowerCase();

        if (written === "true") {
          return t("Yes");
        }

        return !written || written === "false" ? t("No") : field.value || "";
      }

      case ServerEmailEnvironmentVariable.SmtpAuthType:
        return choiceText<SMTPAuthenticationType>(
          field,
          SERVER_EMAIL_SMTP_AUTH_TYPE_VALUES,
          SMTPAuthenticationType.UsernamePassword,
          (choice: SMTPAuthenticationType): string => {
            const radio: RadioButton | undefined = SMTP_AUTH_TYPE_CHOICES.find(
              (candidate: RadioButton): boolean => {
                return candidate.value === choice;
              },
            );

            return t(radio ? radio.title : choice);
          },
        );

      case ServerEmailEnvironmentVariable.SmtpOAuthProviderType:
        return choiceText<OAuthProviderType>(
          field,
          SERVER_EMAIL_SMTP_OAUTH_PROVIDER_TYPE_VALUES,
          OAuthProviderType.ClientCredentials,
          (choice: OAuthProviderType): string => {
            return choice;
          },
        );

      case ServerEmailEnvironmentVariable.AmazonSesAuthenticationType:
        return choiceText<AmazonSesAuthenticationType>(
          field,
          SERVER_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE_VALUES,
          AmazonSesAuthenticationType.AccessKey,
          (choice: AmazonSesAuthenticationType): string => {
            return t(getAmazonSesAuthenticationTypeTitle(choice));
          },
        );

      case ServerEmailEnvironmentVariable.MailgunRegion:
        return choiceText<MailgunRegion>(
          field,
          SERVER_EMAIL_MAILGUN_REGION_VALUES,
          MailgunRegion.US,
          (choice: MailgunRegion): string => {
            return choice;
          },
        );

      default:
        return field.value || t("pages.settings.email.environmentValueNotSet");
    }
  };

  const fields: Array<Field<EnvironmentSettingsItem>> = answer.fields.map(
    (field: ServerEmailEnvironmentField): Field<EnvironmentSettingsItem> => {
      return {
        key: field.variable,
        title: SERVER_EMAIL_ENVIRONMENT_FIELD_TITLES[field.variable],
        description: field.variable,
        fieldType: FieldType.Element,
        getElement: (): ReactElement => {
          const text: string = getValueText(field);

          /*
           * As written in the variable (a host, a name): in its own
           * direction, whatever the page's. A word for it is the page's
           * own, and reads in the page's direction.
           */
          return text === field.value ? <bdi>{text}</bdi> : <span>{text}</span>;
        },
      };
    },
  );

  return (
    <div data-testid={SERVER_EMAIL_ENVIRONMENT_CARD_TEST_ID}>
      <Card
        title={t("pages.settings.email.serverCardTitle")}
        description={t("pages.settings.email.environmentCardDescription")}
      >
        {/*
         * Under a rule across the card, as the saved settings' fields are
         * (CardModelDetail), so the two read as the same card.
         */}
        <div className={CARD_MODEL_DETAIL_BODY_CLASS_NAME}>
          {answer.problems.length > 0 ? (
            <Alert
              type={AlertType.DANGER}
              className="mb-5"
              strongTitle={t("pages.settings.email.environmentProblemsTitle")}
              title={<LineList lines={answer.problems} />}
            />
          ) : (
            <></>
          )}
          {answer.ignored.length > 0 ? (
            <Alert
              type={AlertType.WARNING}
              className="mb-5"
              dataTestId={SERVER_EMAIL_ENVIRONMENT_IGNORED_TEST_ID}
              strongTitle={t("pages.settings.email.environmentIgnoredTitle")}
              title={<LineList lines={answer.ignored} />}
            />
          ) : (
            <></>
          )}
          {/*
           * The variables are server settings, not a record: no ID or
           * creation time, so Detail draws no line under the fields, with no
           * switch to turn it off (RecordIdLineGuard, #7775).
           */}
          <Detail<EnvironmentSettingsItem>
            id="server-email-environment-detail"
            item={item}
            fields={fields}
          />
        </div>
      </Card>
    </div>
  );
};

export default ServerEmailEnvironmentCard;
