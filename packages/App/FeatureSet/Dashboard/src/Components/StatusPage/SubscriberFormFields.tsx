import {
  EMAIL_SUBSCRIBER_STATUS,
  SUBSCRIBER_ADD_CHOICE,
  SUBSCRIBER_STATUS,
  SubscriberAddChoice,
  SubscriberFormCopy,
  SubscriberStatusChoice,
} from "./SubscriberFormChoices";
import { getColumnChoiceField } from "../../Utils/Form/ColumnChoiceField";
import StatusPageSubscriber from "Common/Models/DatabaseModels/StatusPageSubscriber";
import type { ModelField } from "Common/UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";

/*
 * The fields every status page subscriber list's Add and Edit forms share
 * (Email, SMS, Slack, Microsoft Teams and Webhook Subscribers), around each
 * channel's own contact fields. See SubscriberFormChoices.ts for why each
 * one asks what it asks.
 *
 * Every field sits on the forms' first step, "subscriber-info": the second,
 * "notifications", is there only when the status page lets subscribers
 * choose what they hear about.
 */

// The forms' first step, where the contact fields are.
export const SUBSCRIBER_INFO_STEP_ID: string = "subscriber-info";

type SubscriberField = ModelField<StatusPageSubscriber>;

/*
 * Email Subscribers > Add: "When you add them", and the two columns it
 * writes, registered so the form sends them: confirmed and sent nothing,
 * until another answer is picked.
 */
export const getEmailSubscriberAddChoiceFields: () => Array<SubscriberField> =
  (): Array<SubscriberField> => {
    return [
      getColumnChoiceField<StatusPageSubscriber, SubscriberAddChoice>({
        config: SUBSCRIBER_ADD_CHOICE,
        column: "isSubscriptionConfirmed",
        stepId: SUBSCRIBER_INFO_STEP_ID,
        doNotShowWhenEditing: true,
      }),
      {
        field: {
          isSubscriptionConfirmed: true,
        },
        title: "Is Subscription Confirmed",
        stepId: SUBSCRIBER_INFO_STEP_ID,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        hideColumnDescription: true,
        doNotShowWhenEditing: true,
        /*
         * An admin who adds a subscriber vouches for the address: the
         * column's off is for people who subscribe themselves, who confirm
         * by email (CreateFormDefaultsGuard lists why).
         */
        defaultValue: true,
        showIf: (): boolean => {
          return false;
        },
      },
      {
        field: {
          sendYouHaveSubscribedMessage: true,
        },
        title: "Send Subscription Email",
        stepId: SUBSCRIBER_INFO_STEP_ID,
        fieldType: FormFieldSchemaType.Toggle,
        required: false,
        hideColumnDescription: true,
        doNotShowWhenEditing: true,
        /*
         * Off on purpose, though the column defaults to on: someone an admin
         * adds is sent a "you have subscribed" message only when the admin
         * asks for one (CreateFormDefaultsGuard lists why).
         */
        defaultValue: false,
        showIf: (): boolean => {
          return false;
        },
      },
    ];
  };

/*
 * Edit: the subscriber's Status, and the columns it writes, registered so
 * the form loads and saves them. An email subscriber can also be awaiting
 * confirmation.
 */
export const getSubscriberStatusFields: (options: {
  isEmail: boolean;
}) => Array<SubscriberField> = (options: {
  isEmail: boolean;
}): Array<SubscriberField> => {
  const fields: Array<SubscriberField> = [
    getColumnChoiceField<StatusPageSubscriber, SubscriberStatusChoice>({
      config: options.isEmail ? EMAIL_SUBSCRIBER_STATUS : SUBSCRIBER_STATUS,
      column: "isUnsubscribed",
      stepId: SUBSCRIBER_INFO_STEP_ID,
      doNotShowWhenCreating: true,
    }),
    {
      field: {
        isUnsubscribed: true,
      },
      title: "Is Unsubscribed",
      stepId: SUBSCRIBER_INFO_STEP_ID,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      hideColumnDescription: true,
      doNotShowWhenCreating: true,
      showIf: (): boolean => {
        return false;
      },
    },
  ];

  if (options.isEmail) {
    fields.push({
      field: {
        isSubscriptionConfirmed: true,
      },
      title: "Is Subscription Confirmed",
      stepId: SUBSCRIBER_INFO_STEP_ID,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      hideColumnDescription: true,
      doNotShowWhenCreating: true,
      showIf: (): boolean => {
        return false;
      },
    });
  }

  return fields;
};

/*
 * SMS, Slack, Microsoft Teams and Webhook Subscribers > Add: whether the
 * new subscriber is welcomed, folded under More fields with the note. Off,
 * as it always started: an admin who adds somebody decides to tell them.
 */
export const getSubscriberWelcomeField: (
  moreFields: FormFieldCollapsibleSection<StatusPageSubscriber>,
) => SubscriberField = (
  moreFields: FormFieldCollapsibleSection<StatusPageSubscriber>,
): SubscriberField => {
  return {
    field: {
      sendYouHaveSubscribedMessage: true,
    },
    title: SubscriberFormCopy.welcomeTitle,
    description: SubscriberFormCopy.welcomeDescription,
    stepId: SUBSCRIBER_INFO_STEP_ID,
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    doNotShowWhenEditing: true,
    /*
     * Off on purpose, though the column defaults to on: someone an admin
     * adds is sent a "you have subscribed" message only when the admin asks
     * for one (CreateFormDefaultsGuard lists why).
     */
    defaultValue: false,
    collapsibleSection: moreFields,
  };
};

/*
 * The team's own note on a subscriber, folded under More fields on the
 * first step: it used to be a step of its own, a Next for one optional
 * field nobody outside the team reads. A plain box that grows with what is
 * typed: the note is read nowhere but here, so a Markdown editor's toolbar
 * only widened the dialog the moment More fields opened.
 */
export const getSubscriberInternalNoteField: (
  moreFields: FormFieldCollapsibleSection<StatusPageSubscriber>,
) => SubscriberField = (
  moreFields: FormFieldCollapsibleSection<StatusPageSubscriber>,
): SubscriberField => {
  return {
    field: {
      internalNote: true,
    },
    title: "Internal Note",
    description: SubscriberFormCopy.internalNoteDescription,
    stepId: SUBSCRIBER_INFO_STEP_ID,
    fieldType: FormFieldSchemaType.LongText,
    autoGrow: true,
    required: false,
    collapsibleSection: moreFields,
  };
};
