import StatusPageSubscriberChannel, {
  STATUS_PAGE_SUBSCRIBER_CHANNELS,
} from "Common/Types/StatusPage/StatusPageSubscriberChannel";
import StatusPageSubscriberNotificationMethod from "Common/Types/StatusPage/StatusPageSubscriberNotificationMethod";
import NotNull from "Common/Types/BaseDatabase/NotNull";
import Email from "Common/Types/Email";
import Phone from "Common/Types/Phone";
import URL from "Common/Types/API/URL";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import { CSVColumn } from "Common/UI/Components/CSVFileUpload/CSVFileUpload";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FieldType from "Common/UI/Components/Types/FieldType";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import {
  BULK_ADD_NO_VALID_EMAIL,
  BULK_ADD_NO_VALID_PHONE,
  StatusPageBulkAddEntry,
  getBulkEmailEntries,
  getBulkPhoneEntries,
} from "./StatusPageBulkAddEntries";
import {
  SubscriberChannelColumn,
  SubscriberChannelDefinition,
  getSubscriberChannel,
} from "./SubscriberChannelsCopy";
import { SubscriberFormCopy } from "./SubscriberFormChoices";
import SubscriberUnsubscribeCopy from "./SubscriberUnsubscribeCopy";

/*
 * A status page's subscribers, channel by channel, as the one Subscribers
 * page draws them: a tab per channel, every tab the same list
 * (StatusPageSubscriberList) configured by its channel's entry here.
 *
 * Until #9125 each channel was a page of its own - Email Subscribers, SMS
 * Subscribers, Slack Subscribers, Microsoft Teams Subscribers and Webhook
 * Subscribers - five near-copies of one ModelTable on StatusPageSubscriber
 * that differed only in the column a subscriber is reached at, how a list is
 * pasted or uploaded in bulk, and a few words. Those differences are all
 * this file holds, so a fix to the list is made once and reaches every
 * channel.
 *
 * What stays the same on every tab, in StatusPageSubscriberList: the
 * channel's switch while it is off, the warnings, the subscribers the team
 * added who unsubscribed, Add, Edit, Delete, Unsubscribe (in Bulk Actions
 * and each row's menu), Export CSV over a selection, Add in Bulk, the
 * filters and the columns after the contact.
 *
 * React-free, so App's tests can read it as text and Common's can import it.
 */

// How Add in Bulk reads what the person gives it.
export enum SubscriberBulkAddInput {
  // Pasted, one per line, parsed and checked as it is typed.
  Text = "text",
  // A CSV file, from a template the dialog offers.
  Csv = "csv",
}

/*
 * How the Status column reads a subscriber of this channel.
 *
 * Only email and SMS subscribers confirm: the server creates every Slack,
 * Microsoft Teams and webhook subscriber confirmed, as nobody is there to
 * ask (StatusPageSubscriberService.onBeforeCreate), so their lists showed an
 * Awaiting Confirmation that could not happen, and filtered by it.
 */
export enum SubscriberStatusKind {
  /*
   * Subscribed, Awaiting Confirmation while the link sent to them works,
   * Link Expired, or Unsubscribed (SubscriberStatusPill).
   */
  ConfirmationLink = "confirmation-link",
  // Subscribed or Unsubscribed.
  SubscribedOnly = "subscribed-only",
}

export type SubscriberContactColumn =
  | "subscriberEmail"
  | "subscriberPhone"
  | "slackWorkspaceName"
  | "microsoftTeamsWorkspaceName"
  | "subscriberWebhook";

export interface SubscriberTextBulkAdd {
  input: SubscriberBulkAddInput.Text;
  fieldTitle: string;
  fieldDescription: string;
  placeholder: string;
  // Numbers read left to right in every language (#7180).
  readsLeftToRight: boolean;
  getEntries: (text: string) => Array<StatusPageBulkAddEntry>;
  // What the field says when nothing pasted can be added.
  nothingToAddError: string;
  formName: string;
}

export interface SubscriberCsvBulkAdd {
  input: SubscriberBulkAddInput.Csv;
  columns: Array<CSVColumn>;
  templateFileName: string;
  // The column holding what is added, and the one that names each row.
  valueColumn: string;
  nameColumn?: string | undefined;
}

export interface SubscriberListChannel {
  channel: StatusPageSubscriberChannel;
  // The channel's name, its switch and its column (SubscriberChannelsCopy).
  copy: SubscriberChannelDefinition;
  method: StatusPageSubscriberNotificationMethod;
  enabledColumn: SubscriberChannelColumn;
  // Where a subscriber of this channel is reached; set on every one of them.
  contactColumn: SubscriberContactColumn;
  /*
   * The table's ids and stored preferences, as each channel's page had
   * them, so nobody's saved columns, filters or tests are lost.
   */
  tableId: string;
  tableName: string;
  userPreferencesKey: string;
  savedFiltersTableId: string;
  cardTitle: string;
  cardDescription: string;
  // The fields a subscriber of this channel is reached at, on Add and Edit.
  contactFields: Array<ModelField<StatusPageSubscriber>>;
  // The first column and the first filter: the contact.
  contactColumnTitle: string;
  contactColumnType: FieldType;
  contactFilterTitle: string;
  contactFilterType: FieldType;
  /*
   * Email asks "When you add them" (subscribe now, tell them, or ask them to
   * confirm first); the other channels ask whether to send a welcome.
   */
  asksHowToAdd: boolean;
  // The channel's Status choices on Edit (getSubscriberStatusFields).
  statusFieldOptions: { isEmail: boolean; isPhone?: boolean | undefined };
  statusKind: SubscriberStatusKind;
  // How the confirmation link reaches them, for the Status pill.
  awaitingConfirmationDescription?: string | undefined;
  // A language of its own: everything but a webhook, which is JSON.
  hasLanguage: boolean;
  bulkAdd: SubscriberTextBulkAdd | SubscriberCsvBulkAdd;
  bulkAddTitle: string;
  bulkAddDescription: string;
  // Writes an entry of Add in Bulk into a new subscriber's contact.
  writeBulkEntry: (
    subscriber: StatusPageSubscriber,
    entry: StatusPageBulkAddEntry,
  ) => void;
}

const LIST_CHANNELS: Record<
  StatusPageSubscriberChannel,
  SubscriberListChannel
> = {
  [StatusPageSubscriberChannel.Email]: {
    channel: StatusPageSubscriberChannel.Email,
    copy: getSubscriberChannel(StatusPageSubscriberNotificationMethod.Email),
    method: StatusPageSubscriberNotificationMethod.Email,
    enabledColumn: "enableEmailSubscribers",
    contactColumn: "subscriberEmail",
    tableId: "table-subscriber",
    tableName: "Status Page > Email Subscribers",
    userPreferencesKey: "status-page-subscriber-table",
    savedFiltersTableId: "status-page-email-subscribers-table",
    cardTitle: "Email Subscribers",
    cardDescription:
      "People who get this status page's updates by email. Visitors subscribe on the status page, or you can add them here.",
    contactFields: [
      {
        field: {
          subscriberEmail: true,
        },
        stepId: "subscriber-info",
        title: "Email",
        /*
         * Every notification can be unsubscribed from without signing in,
         * so one reader of a shared address can take it off this page for
         * everyone who reads it.
         */
        description: SubscriberUnsubscribeCopy.sharedAddressAdvice,
        fieldType: FormFieldSchemaType.Email,
        required: true,
        placeholder: "subscriber@company.com",
        disableSpellCheck: true,
      },
    ],
    contactColumnTitle: "Email",
    contactColumnType: FieldType.Email,
    contactFilterTitle: "Email",
    contactFilterType: FieldType.Text,
    asksHowToAdd: true,
    statusFieldOptions: { isEmail: true },
    statusKind: SubscriberStatusKind.ConfirmationLink,
    // Awaiting the link we emailed them, while it works.
    awaitingConfirmationDescription:
      SubscriberFormCopy.awaitingConfirmationDescription,
    hasLanguage: true,
    bulkAdd: {
      input: SubscriberBulkAddInput.Text,
      fieldTitle: "Emails",
      fieldDescription:
        "One email per line. Invalid and duplicate ones are skipped.",
      placeholder: "user1@example.com\nuser2@example.com\nuser3@example.com",
      readsLeftToRight: false,
      getEntries: getBulkEmailEntries,
      nothingToAddError: BULK_ADD_NO_VALID_EMAIL,
      formName: "Bulk Add Subscribers",
    },
    bulkAddTitle: "Add Email Subscribers in Bulk",
    bulkAddDescription:
      "Paste email addresses below. These subscribers will be added to this status page.",
    writeBulkEntry: (
      subscriber: StatusPageSubscriber,
      entry: StatusPageBulkAddEntry,
    ): void => {
      subscriber.subscriberEmail = new Email(entry.value);
    },
  },
  [StatusPageSubscriberChannel.SMS]: {
    channel: StatusPageSubscriberChannel.SMS,
    copy: getSubscriberChannel(StatusPageSubscriberNotificationMethod.SMS),
    method: StatusPageSubscriberNotificationMethod.SMS,
    enabledColumn: "enableSmsSubscribers",
    contactColumn: "subscriberPhone",
    tableId: "table-subscriber",
    tableName: "Status Page > SMS Subscribers",
    userPreferencesKey: "status-page-sms-subscribers-table",
    savedFiltersTableId: "status-page-sms-subscribers-table",
    cardTitle: "SMS Subscribers",
    cardDescription:
      "Phone numbers that get this status page's updates by text message. Visitors subscribe on the status page, or you can add them here.",
    contactFields: [
      {
        field: {
          subscriberPhone: true,
        },
        stepId: "subscriber-info",
        title: "Phone Number",
        description: "Status page updates will be sent to this phone number.",
        fieldType: FormFieldSchemaType.Phone,
        required: true,
        placeholder: "+11234567890",
      },
    ],
    contactColumnTitle: "SMS",
    contactColumnType: FieldType.Phone,
    contactFilterTitle: "Phone Number",
    contactFilterType: FieldType.Phone,
    asksHowToAdd: false,
    statusFieldOptions: { isEmail: false, isPhone: true },
    statusKind: SubscriberStatusKind.ConfirmationLink,
    /*
     * Someone who signed up by SMS on the status page awaits the link
     * texted to them, while it works.
     */
    awaitingConfirmationDescription:
      SubscriberFormCopy.awaitingTextConfirmationDescription,
    hasLanguage: true,
    bulkAdd: {
      input: SubscriberBulkAddInput.Text,
      fieldTitle: "Phone Numbers",
      fieldDescription:
        "One phone number per line (or separated by commas or semicolons). Invalid or duplicate entries will be skipped.",
      placeholder: "+11234567890\n+11234567891\n+11234567892",
      /*
       * Numbers read left to right in every language, the example's with
       * them: on a Persian or Arabic page each "+" went after its digits
       * (#7180).
       */
      readsLeftToRight: true,
      getEntries: getBulkPhoneEntries,
      nothingToAddError: BULK_ADD_NO_VALID_PHONE,
      formName: "Bulk Add SMS Subscribers",
    },
    bulkAddTitle: "Add SMS Subscribers in Bulk",
    bulkAddDescription:
      "Paste phone numbers below. These subscribers will be added to this status page.",
    writeBulkEntry: (
      subscriber: StatusPageSubscriber,
      entry: StatusPageBulkAddEntry,
    ): void => {
      subscriber.subscriberPhone = new Phone(entry.value);
    },
  },
  [StatusPageSubscriberChannel.Slack]: {
    channel: StatusPageSubscriberChannel.Slack,
    copy: getSubscriberChannel(StatusPageSubscriberNotificationMethod.Slack),
    method: StatusPageSubscriberNotificationMethod.Slack,
    enabledColumn: "enableSlackSubscribers",
    contactColumn: "slackWorkspaceName",
    tableId: "table-slack-subscriber",
    tableName: "Status Page > Slack Subscribers",
    userPreferencesKey: "status-page-slack-subscribers-table",
    savedFiltersTableId: "status-page-slack-subscribers-table",
    cardTitle: "Slack Subscribers",
    cardDescription:
      "Slack channels that get this status page's updates. Visitors subscribe on the status page, or you can add them here.",
    contactFields: [
      {
        field: {
          slackWorkspaceName: true,
        },
        stepId: "subscriber-info",
        title: "Slack Workspace Name",
        description: "Name of the Slack workspace for identification.",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "my-company-workspace",
      },
      {
        field: {
          slackIncomingWebhookUrl: true,
        },
        stepId: "subscriber-info",
        title: "Slack Incoming Webhook URL",
        description: "Status page updates will be sent to this Slack channel.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://hooks.slack.com/services/...",
        disableSpellCheck: true,
      },
    ],
    contactColumnTitle: "Workspace Name",
    contactColumnType: FieldType.Text,
    contactFilterTitle: "Slack Workspace Name",
    contactFilterType: FieldType.Text,
    asksHowToAdd: false,
    statusFieldOptions: { isEmail: false },
    statusKind: SubscriberStatusKind.SubscribedOnly,
    hasLanguage: true,
    bulkAdd: {
      input: SubscriberBulkAddInput.Csv,
      columns: [
        {
          key: "workspaceName",
          title: "Workspace Name",
          required: true,
          description: "Name of the Slack workspace for identification",
        },
        {
          key: "webhookUrl",
          title: "Incoming Webhook URL",
          required: true,
          description: "Slack incoming webhook URL",
        },
      ],
      templateFileName: "slack-subscribers-template.csv",
      valueColumn: "webhookUrl",
      // Each row named in the result by its workspace, as the list names it.
      nameColumn: "workspaceName",
    },
    bulkAddTitle: "Add Slack Subscribers in Bulk",
    bulkAddDescription:
      "Upload a CSV file with Slack workspace names and webhook URLs. Download the template to get started.",
    writeBulkEntry: (
      subscriber: StatusPageSubscriber,
      entry: StatusPageBulkAddEntry,
    ): void => {
      subscriber.slackIncomingWebhookUrl = URL.fromString(entry.value);
      subscriber.slackWorkspaceName = entry.row?.["workspaceName"] || "";
    },
  },
  [StatusPageSubscriberChannel.MicrosoftTeams]: {
    channel: StatusPageSubscriberChannel.MicrosoftTeams,
    copy: getSubscriberChannel(
      StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    ),
    method: StatusPageSubscriberNotificationMethod.MicrosoftTeams,
    enabledColumn: "enableMicrosoftTeamsSubscribers",
    contactColumn: "microsoftTeamsWorkspaceName",
    tableId: "table-microsoft-teams-subscriber",
    tableName: "Status Page > Microsoft Teams Subscribers",
    userPreferencesKey: "status-page-microsoft-teams-subscribers-table",
    savedFiltersTableId: "status-page-microsoft-teams-subscribers-table",
    cardTitle: "Microsoft Teams Subscribers",
    cardDescription:
      "Microsoft Teams channels that get this status page's updates. Visitors subscribe on the status page, or you can add them here.",
    contactFields: [
      {
        field: {
          microsoftTeamsWorkspaceName: true,
        },
        stepId: "subscriber-info",
        title: "Microsoft Teams Workspace Name",
        description:
          "Name of the Microsoft Teams workspace for identification.",
        fieldType: FormFieldSchemaType.Text,
        required: true,
        placeholder: "my-company-workspace",
      },
      {
        field: {
          microsoftTeamsIncomingWebhookUrl: true,
        },
        stepId: "subscriber-info",
        title: "Microsoft Teams Incoming Webhook URL",
        description: "Status page updates will be sent to this Teams channel.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://xxxxx.office.com/webhook/...",
        disableSpellCheck: true,
      },
    ],
    contactColumnTitle: "Workspace Name",
    contactColumnType: FieldType.Text,
    contactFilterTitle: "Teams Workspace Name",
    contactFilterType: FieldType.Text,
    asksHowToAdd: false,
    statusFieldOptions: { isEmail: false },
    statusKind: SubscriberStatusKind.SubscribedOnly,
    hasLanguage: true,
    bulkAdd: {
      input: SubscriberBulkAddInput.Csv,
      columns: [
        {
          key: "workspaceName",
          title: "Workspace Name",
          required: true,
          description:
            "Name of the Microsoft Teams workspace for identification",
        },
        {
          key: "webhookUrl",
          title: "Incoming Webhook URL",
          required: true,
          description: "Microsoft Teams incoming webhook URL",
        },
      ],
      templateFileName: "microsoft-teams-subscribers-template.csv",
      valueColumn: "webhookUrl",
      nameColumn: "workspaceName",
    },
    bulkAddTitle: "Add Microsoft Teams Subscribers in Bulk",
    bulkAddDescription:
      "Upload a CSV file with Microsoft Teams workspace names and webhook URLs. Download the template to get started.",
    writeBulkEntry: (
      subscriber: StatusPageSubscriber,
      entry: StatusPageBulkAddEntry,
    ): void => {
      subscriber.microsoftTeamsIncomingWebhookUrl = URL.fromString(entry.value);
      subscriber.microsoftTeamsWorkspaceName =
        entry.row?.["workspaceName"] || "";
    },
  },
  [StatusPageSubscriberChannel.Webhook]: {
    channel: StatusPageSubscriberChannel.Webhook,
    copy: getSubscriberChannel(StatusPageSubscriberNotificationMethod.Webhook),
    method: StatusPageSubscriberNotificationMethod.Webhook,
    enabledColumn: "enableWebhookSubscribers",
    contactColumn: "subscriberWebhook",
    tableId: "table-webhook-subscriber",
    tableName: "Status Page > Webhook Subscribers",
    userPreferencesKey: "status-page-webhook-subscribers-table",
    savedFiltersTableId: "status-page-webhook-subscribers-table",
    cardTitle: "Webhook Subscribers",
    cardDescription:
      "URLs that get each of this status page's updates as a JSON POST request, for your own tools. Visitors subscribe on the status page, or you can add them here.",
    contactFields: [
      {
        field: {
          subscriberWebhook: true,
        },
        stepId: "subscriber-info",
        title: "Webhook URL",
        description:
          "A JSON POST request will be sent to this webhook on each status page event.",
        fieldType: FormFieldSchemaType.URL,
        required: true,
        placeholder: "https://example.com/webhook",
        disableSpellCheck: true,
      },
    ],
    contactColumnTitle: "Webhook URL",
    contactColumnType: FieldType.URL,
    contactFilterTitle: "Webhook URL",
    contactFilterType: FieldType.URL,
    asksHowToAdd: false,
    statusFieldOptions: { isEmail: false },
    statusKind: SubscriberStatusKind.SubscribedOnly,
    // A webhook gets JSON: there is no language to write it in.
    hasLanguage: false,
    bulkAdd: {
      input: SubscriberBulkAddInput.Csv,
      columns: [
        {
          key: "webhookUrl",
          title: "Webhook URL",
          required: true,
          description:
            "URL to which a JSON POST request will be sent on each status page event.",
        },
      ],
      templateFileName: "webhook-subscribers-template.csv",
      valueColumn: "webhookUrl",
    },
    bulkAddTitle: "Add Webhook Subscribers in Bulk",
    bulkAddDescription:
      "Upload a CSV file with webhook URLs. Download the template to get started.",
    writeBulkEntry: (
      subscriber: StatusPageSubscriber,
      entry: StatusPageBulkAddEntry,
    ): void => {
      subscriber.subscriberWebhook = URL.fromString(entry.value);
    },
  },
};

// Every channel's list, in tab order.
export const SUBSCRIBER_LIST_CHANNELS: ReadonlyArray<SubscriberListChannel> =
  STATUS_PAGE_SUBSCRIBER_CHANNELS.map(
    (channel: StatusPageSubscriberChannel): SubscriberListChannel => {
      return LIST_CHANNELS[channel];
    },
  );

export const getSubscriberListChannel: (
  channel: StatusPageSubscriberChannel,
) => SubscriberListChannel = (
  channel: StatusPageSubscriberChannel,
): SubscriberListChannel => {
  return LIST_CHANNELS[channel];
};

// The channel whose tab is named this, as the Tabs hand it back.
export const getSubscriberListChannelByTabName: (
  tabName: string,
) => SubscriberListChannel | undefined = (
  tabName: string,
): SubscriberListChannel | undefined => {
  return SUBSCRIBER_LIST_CHANNELS.find(
    (definition: SubscriberListChannel): boolean => {
      return definition.copy.title === tabName;
    },
  );
};

// What picks out a channel's subscribers: its contact column is set.
export const getSubscriberChannelQuery: (
  definition: SubscriberListChannel,
) => Query<StatusPageSubscriber> = (
  definition: SubscriberListChannel,
): Query<StatusPageSubscriber> => {
  return {
    [definition.contactColumn]: new NotNull(),
  } as Query<StatusPageSubscriber>;
};

// The contact column, to read a subscriber's name by.
export const getSubscriberContactSelect: (
  definition: SubscriberListChannel,
) => Select<StatusPageSubscriber> = (
  definition: SubscriberListChannel,
): Select<StatusPageSubscriber> => {
  return {
    [definition.contactColumn]: true,
  } as Select<StatusPageSubscriber>;
};
