import { Green, Red } from "Common/Types/BrandColors";
import ObjectID from "Common/Types/ObjectID";
import CardModelDetail from "Common/UI/Components/ModelDetail/CardModelDetail";
import Field from "Common/UI/Components/ModelDetail/Field";
import Pill from "Common/UI/Components/Pill/Pill";
import {
  GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS,
  GlobalEmailProviderMissingSetting,
  GlobalEmailProviderTransport,
  getGlobalEmailProviderFormFields,
  getGlobalEmailProviderFormSteps,
  getAmazonSesAuthenticationTypeTitle,
  getGlobalEmailProviderMissingSetting,
  usesAmazonSesServerIamRole,
} from "Common/UI/Components/SmtpConfig/SmtpConfigFormFields";
import FieldType from "Common/UI/Components/Types/FieldType";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Select from "Common/Types/BaseDatabase/Select";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";

/*
 * A PROVIDER'S CARD: Admin Dashboard > Settings > Email, for an Email Server
 * Type that sends through a provider's HTTP API - Amazon SES, Mailgun,
 * Postmark or Resend - beside SendGrid's own card.
 *
 * Its dialog asks what that provider needs and nothing else, in two steps -
 * the provider's own (its key, and where it sends from), then Sender - from
 * the builder a project's form is made from (SmtpConfigFormFields), so the
 * server's settings and a project's ask the same questions in the same
 * words. Its rows say whether the server sends through it now (Enabled, or
 * what is still missing), then what tells the account apart - how Amazon
 * SES is signed in to (the access key, or this server's IAM role), the
 * access key ID and Region, the Mailgun domain and region - and who the
 * emails come from. No key is ever shown: the status reads only whether one
 * is set.
 */

export interface ComponentProps {
  transport: GlobalEmailProviderTransport;
  // The settings were saved: the page reads again where email stands.
  onSaveSuccess?: (() => void) | undefined;
}

interface ProviderCardCopy {
  name: string;
  titleKey: string;
  descriptionKey: string;
  editButtonKey: string;
  // The column whose row holds the status pill: the provider's key.
  keyColumn: keyof GlobalConfig;
}

export const EMAIL_PROVIDER_CARD_COPY: Readonly<
  Record<GlobalEmailProviderTransport, ProviderCardCopy>
> = {
  "Amazon SES": {
    name: "Amazon SES Settings",
    titleKey: "pages.settings.email.amazonSesCardTitle",
    descriptionKey: "pages.settings.email.amazonSesCardDescription",
    editButtonKey: "pages.settings.email.amazonSesEditButton",
    keyColumn: "amazonSesSecretAccessKey",
  },
  Mailgun: {
    name: "Mailgun Settings",
    titleKey: "pages.settings.email.mailgunCardTitle",
    descriptionKey: "pages.settings.email.mailgunCardDescription",
    editButtonKey: "pages.settings.email.mailgunEditButton",
    keyColumn: "mailgunApiKey",
  },
  Postmark: {
    name: "Postmark Settings",
    titleKey: "pages.settings.email.postmarkCardTitle",
    descriptionKey: "pages.settings.email.postmarkCardDescription",
    editButtonKey: "pages.settings.email.postmarkEditButton",
    keyColumn: "postmarkServerToken",
  },
  Resend: {
    name: "Resend Settings",
    titleKey: "pages.settings.email.resendCardTitle",
    descriptionKey: "pages.settings.email.resendCardDescription",
    editButtonKey: "pages.settings.email.resendEditButton",
    keyColumn: "resendApiKey",
  },
};

// The pill each missing setting reads as.
export const MISSING_SETTING_PILL_KEYS: Readonly<
  Record<GlobalEmailProviderMissingSetting, string>
> = {
  [GlobalEmailProviderMissingSetting.AccessKey]:
    "pages.settings.email.pillNoAccessKey",
  [GlobalEmailProviderMissingSetting.Region]:
    "pages.settings.email.pillNoRegion",
  [GlobalEmailProviderMissingSetting.ApiKey]:
    "pages.settings.email.pillNoApiKey",
  [GlobalEmailProviderMissingSetting.Domain]:
    "pages.settings.email.pillNoDomain",
  [GlobalEmailProviderMissingSetting.ServerToken]:
    "pages.settings.email.pillNoServerToken",
  [GlobalEmailProviderMissingSetting.FromEmail]:
    "pages.settings.email.pillNoFromEmail",
};

// What the card reads besides its rows: everything the status asks about.
const STATUS_SELECT: Readonly<
  Record<GlobalEmailProviderTransport, Select<GlobalConfig>>
> = {
  "Amazon SES": {
    amazonSesAuthenticationType: true,
    amazonSesAccessKeyId: true,
    amazonSesSecretAccessKey: true,
    amazonSesRegion: true,
    amazonSesFromEmail: true,
    amazonSesFromName: true,
  },
  Mailgun: {
    mailgunApiKey: true,
    mailgunDomain: true,
    mailgunRegion: true,
    mailgunFromEmail: true,
    mailgunFromName: true,
  },
  Postmark: {
    postmarkServerToken: true,
    postmarkFromEmail: true,
    postmarkFromName: true,
  },
  Resend: {
    resendApiKey: true,
    resendFromEmail: true,
    resendFromName: true,
  },
};

const EmailProviderSettingsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { t } = useTranslation();
  const copy: ProviderCardCopy = EMAIL_PROVIDER_CARD_COPY[props.transport];
  const sender: {
    fromEmail: keyof GlobalConfig;
    fromName: keyof GlobalConfig;
  } = GLOBAL_EMAIL_PROVIDER_SENDER_COLUMNS[props.transport];

  // The rows that tell this provider's account apart, between status and sender.
  const accountRows: Array<Field<GlobalConfig>> =
    props.transport === "Amazon SES"
      ? [
          {
            field: { amazonSesAuthenticationType: true },
            title: "Authentication Type",
            fieldType: FieldType.Element,
            getElement: (item: GlobalConfig): ReactElement => {
              // Never picked: the server signs in with its access key.
              return (
                <span>
                  {t(
                    getAmazonSesAuthenticationTypeTitle(
                      item.amazonSesAuthenticationType,
                    ),
                  )}
                </span>
              );
            },
          },
          {
            field: { amazonSesAccessKeyId: true },
            title: "Access Key ID",
            placeholder: "None",
            // The server's IAM role has no key to tell apart (#7000).
            showIf: (item: GlobalConfig): boolean => {
              return !usesAmazonSesServerIamRole(item);
            },
          },
          {
            field: { amazonSesRegion: true },
            title: "Region",
            placeholder: "None",
          },
        ]
      : props.transport === "Mailgun"
        ? [
            {
              field: { mailgunDomain: true },
              title: "Domain",
              placeholder: "None",
            },
            {
              field: { mailgunRegion: true },
              title: "Region",
              // What the mail service sends through when none is picked.
              placeholder: "US",
            },
          ]
        : [];

  return (
    <CardModelDetail<GlobalConfig>
      name={copy.name}
      cardProps={{
        title: t(copy.titleKey),
        description: t(copy.descriptionKey),
      }}
      isEditable={true}
      editButtonText={t(copy.editButtonKey)}
      // Titled like the button that opens it, not "Edit Global Config".
      editModalTitle={t(copy.editButtonKey)}
      onSaveSuccess={() => {
        props.onSaveSuccess?.();
      }}
      formSteps={getGlobalEmailProviderFormSteps(props.transport)}
      formFields={getGlobalEmailProviderFormFields(props.transport)}
      modelDetailProps={{
        modelType: GlobalConfig,
        id: "model-detail-global-config",
        selectMoreFields: STATUS_SELECT[props.transport],
        fields: [
          {
            field: { [copy.keyColumn]: true },
            title: "Status",
            fieldType: FieldType.Element,
            getElement: (item: GlobalConfig): ReactElement => {
              const missing: GlobalEmailProviderMissingSetting | null =
                getGlobalEmailProviderMissingSetting(props.transport, item);

              if (!missing) {
                return (
                  <Pill
                    text={t("pages.settings.email.pillEnabled")}
                    color={Green}
                  />
                );
              }

              return (
                <Pill
                  text={t(MISSING_SETTING_PILL_KEYS[missing])}
                  color={Red}
                />
              );
            },
          },
          ...accountRows,
          {
            field: { [sender.fromEmail]: true },
            title: "From Email",
            placeholder: "None",
            fieldType: FieldType.Email,
          },
          {
            field: { [sender.fromName]: true },
            title: "From Name",
            placeholder: "None",
          },
        ],
        modelId: ObjectID.getZeroObjectID(),
      }}
    />
  );
};

export default EmailProviderSettingsCard;
