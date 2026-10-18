import { ColumnChoiceConfig } from "../../Utils/Form/ColumnChoice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * THE EMAIL FOOTER CARD, UNDER MORE SETTINGS ON SUBSCRIBER SETTINGS.
 *
 * "Email Footer Settings" asked "Enable Custom Email Footer Text - Enable
 * custom footer text in subscriber email notifications. If disabled,
 * default footer text will be used." and, while it was on, the text. One
 * question, two plain answers: the default footer, or your own text - and
 * only for your own text, the box. Each answer writes the same switch as
 * before (enableCustomSubscriberEmailNotificationFooterText), and the text
 * stays what it was whichever is picked, so switching back to your own text
 * finds it again. The card shows the line subscribers read: your text, or
 * the default line with a Default pill (Common/Types/StatusPage/
 * SubscriberEmailFooter decides which, as the senders do).
 *
 * Kept free of React so the page and App/Tests read these exact strings.
 */

export enum EmailFooterChoice {
  Default = "default",
  Custom = "custom",
}

export const EMAIL_FOOTER_CHOICE_FIELD_KEY: string = "emailFooterChoice";

export const EMAIL_FOOTER_CARD_TEST_ID: string = "status-page-email-footer";

export const SubscriberEmailFooterCopy: {
  cardTitle: string;
  cardDescription: string;
  choiceTitle: string;
  defaultTitle: string;
  defaultDescription: string;
  customTitle: string;
  customDescription: string;
  textTitle: string;
  // The card's row, and the pill beside the default line.
  rowTitle: string;
  defaultPill: string;
  editButton: string;
} = {
  cardTitle: translationKey("Email Footer"),
  cardDescription: translationKey(
    "The line at the end of every email to this page's subscribers.",
  ),
  choiceTitle: translationKey("Footer"),
  defaultTitle: translationKey("The default footer"),
  defaultDescription: translationKey(
    "A line that says they get the email because they subscribed.",
  ),
  customTitle: translationKey("Your own text"),
  customDescription: translationKey("Add a note, a link or a support address."),
  textTitle: translationKey("Footer Text"),
  rowTitle: translationKey("Footer"),
  defaultPill: translationKey("Default"),
  editButton: translationKey("Edit Footer"),
};

export const EMAIL_FOOTER_CHOICE: ColumnChoiceConfig<EmailFooterChoice> = {
  key: EMAIL_FOOTER_CHOICE_FIELD_KEY,
  title: SubscriberEmailFooterCopy.choiceTitle,
  options: [
    {
      value: EmailFooterChoice.Default,
      title: SubscriberEmailFooterCopy.defaultTitle,
      description: SubscriberEmailFooterCopy.defaultDescription,
    },
    {
      value: EmailFooterChoice.Custom,
      title: SubscriberEmailFooterCopy.customTitle,
      description: SubscriberEmailFooterCopy.customDescription,
    },
  ],
  readChoice: (values: Record<string, unknown>): EmailFooterChoice => {
    return values["enableCustomSubscriberEmailNotificationFooterText"] === true
      ? EmailFooterChoice.Custom
      : EmailFooterChoice.Default;
  },
  getColumns: (choice: EmailFooterChoice): Record<string, unknown> => {
    return {
      enableCustomSubscriberEmailNotificationFooterText:
        choice === EmailFooterChoice.Custom,
    };
  },
  dataTestId: "email-footer-choice",
};

export default SubscriberEmailFooterCopy;
