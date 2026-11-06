import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import MailgunRegion, {
  toMailgunRegion,
} from "Common/Types/Email/MailgunRegion";
import MailTransportType, {
  toMailTransportType,
} from "Common/Types/Email/MailTransportType";
import IconProp from "Common/Types/Icon/IconProp";
import { CardSelectOption } from "Common/UI/Components/CardSelect/CardSelect";
import Icon from "Common/UI/Components/Icon/Icon";
import { EMAIL_PROVIDER_CHOICES } from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A CONFIG SENDS THROUGH, AT A GLANCE: the Custom SMTP Configs table's
 * "Sends Through" cell. The provider's icon, as on its card in the form,
 * then what tells two configs of one provider apart:
 *
 *   - an SMTP server: its hostname (smtp.gmail.com);
 *   - Amazon SES: "Amazon SES" and its Region (us-east-1);
 *   - Mailgun: "Mailgun" and its domain, with "EU" for an EU domain;
 *   - SendGrid, Postmark, Resend, Microsoft Graph: the provider's name.
 *
 * Nothing secret is read: the table selects the transport, the Region and
 * the domain, never a key.
 */

export interface ComponentProps {
  config: ProjectSmtpConfig;
}

// What the cell says after the provider's name, or "" for nothing more.
export const getEmailProviderDetail: (config: ProjectSmtpConfig) => string = (
  config: ProjectSmtpConfig,
): string => {
  switch (toMailTransportType(config.transportType)) {
    case MailTransportType.AmazonSES:
      return config.amazonSesRegion?.trim() || "";
    case MailTransportType.Mailgun: {
      const domain: string = config.mailgunDomain?.trim() || "";

      if (toMailgunRegion(config.mailgunRegion) === MailgunRegion.EU) {
        return domain ? `${domain} (EU)` : "EU";
      }

      return domain;
    }
    default:
      return "";
  }
};

const EmailProviderSummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const transport: MailTransportType = toMailTransportType(
    props.config.transportType,
  );
  const choice: CardSelectOption | undefined = EMAIL_PROVIDER_CHOICES.find(
    (candidate: CardSelectOption): boolean => {
      return candidate.value === transport;
    },
  );

  // An SMTP server is told apart by its host, as the column always showed.
  if (transport === MailTransportType.SMTP) {
    return (
      <span
        className="inline-flex min-w-0 items-center gap-1.5"
        data-testid="email-provider-summary"
      >
        <Icon
          icon={IconProp.Server}
          className="h-4 w-4 flex-shrink-0 text-gray-400"
        />
        <span className="truncate">
          {props.config.hostname?.toString() || "-"}
        </span>
      </span>
    );
  }

  const detail: string = getEmailProviderDetail(props.config);

  return (
    <span
      className="inline-flex min-w-0 items-center gap-1.5"
      data-testid="email-provider-summary"
    >
      <Icon
        icon={choice?.icon || IconProp.Email}
        className="h-4 w-4 flex-shrink-0 text-gray-400"
      />
      <span className="truncate">
        {choice
          ? choice.isTitleProductName
            ? choice.title
            : translator.translateText(choice.title) || choice.title
          : transport}
      </span>
      {detail ? (
        <span className="truncate text-gray-500">{detail}</span>
      ) : (
        <></>
      )}
    </span>
  );
};

export default EmailProviderSummary;
