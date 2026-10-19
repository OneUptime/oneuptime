import { ColumnChoiceConfig } from "../../Utils/Form/ColumnChoice";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import SubscriptionConfirmationLink from "Common/Types/StatusPage/SubscriptionConfirmationLink";

/*
 * ADDING A SUBSCRIBER BY HAND, AND CHANGING ONE: PLAIN CHOICES.
 *
 * The Add form of a status page's Email Subscribers asked two switches:
 * "Do not send confirmation link" (on) - "If this option is checked, then
 * no confirmation link will be sent to the subscriber." - and "Send
 * Subscription Email" (off) - "Send Email with the confirmation link to the
 * subscriber. The subscriber needs to click on the link to confirm the
 * subscription." The second said the opposite of what it did: with the
 * first on, it sends a "you have subscribed" email, with no link to
 * confirm; with the first off, it does nothing at all - a confirmation link
 * goes out either way (StatusPageSubscriberService.onCreateSuccess).
 *
 * Read together they are one question with three answers, so the form asks
 * that: subscribe them now (as before, what a new subscriber starts with),
 * subscribe them now and tell them, or ask them to confirm first. Each
 * answer writes the same two columns the switches wrote
 * (isSubscriptionConfirmed, sendYouHaveSubscribedMessage), so the same
 * answers save the same values as before, and the API and Terraform are
 * unchanged. Add in Bulk asks the same question.
 *
 * Editing a subscriber showed "Do not send confirmation link" again - on a
 * subscriber who exists, it only said whether they had confirmed - beside
 * an "Unsubscribe" switch. Its Edit form now asks for its Status, in the
 * words of the table's Status column: Subscribed, Awaiting Confirmation
 * (email and SMS, and only while they are awaiting it - nothing sends a new
 * link), Unsubscribed. Each writes isUnsubscribed, and an email or SMS
 * subscriber's isSubscriptionConfirmed.
 *
 * A visitor who signs up by SMS on the status page confirms from their
 * phone, by the link texted to it; an SMS subscriber the team adds is
 * confirmed at once, and so is every Slack, Microsoft Teams and webhook
 * subscriber. So those Add forms keep one switch, Send a welcome message,
 * now folded with the internal note under More fields: off, as before,
 * unless somebody turns it on.
 *
 * The link to confirm works for a day after it is sent
 * (Common/Types/StatusPage/SubscriptionConfirmationLink). An email or SMS
 * subscriber who has not opened it by then never will, and is sent
 * nothing: the table's Status shows Link Expired for them, and how to get
 * them a new link (getSubscriberTableStatus, SubscriberStatusPill).
 *
 * Kept free of React, so App/Tests read these exact strings and rules.
 * Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files.
 */

// What happens when somebody adds an email subscriber by hand.
export enum SubscriberAddChoice {
  // Confirmed at once, and sent nothing: what the form starts with.
  SubscribeNow = "subscribe-now",
  // Confirmed at once, and sent a "you have subscribed" email.
  SubscribeAndTell = "subscribe-and-tell",
  // Sent a confirmation link; updates start once it is clicked.
  AskToConfirm = "ask-to-confirm",
}

// A subscriber's status, as the subscriber tables' Status column says it.
export enum SubscriberStatusChoice {
  Subscribed = "subscribed",
  /*
   * Only an email subscriber, and an SMS subscriber who signed up on the
   * status page, waits for anything.
   */
  AwaitingConfirmation = "awaiting-confirmation",
  Unsubscribed = "unsubscribed",
}

type Values = Record<string, unknown>;

export const SubscriberFormCopy: {
  addChoiceTitle: string;
  subscribeNowTitle: string;
  subscribeNowDescription: string;
  subscribeAndTellTitle: string;
  subscribeAndTellDescription: string;
  askToConfirmTitle: string;
  askToConfirmDescription: string;
  statusTitle: string;
  subscribedTitle: string;
  subscribedDescription: string;
  awaitingConfirmationTitle: string;
  awaitingConfirmationDescription: string;
  awaitingTextConfirmationDescription: string;
  unsubscribedTitle: string;
  unsubscribedDescription: string;
  linkExpiredTitle: string;
  linkExpiredDescription: string;
  welcomeTitle: string;
  welcomeDescription: string;
  internalNoteDescription: string;
  /*
   * Every channel's list names its rows Subscriber(s) and adds one with
   * "Add" (the table's singularName / createVerb): these are the phrases
   * the table looks up whole - its button, its dialog's title - and the
   * name it puts into its other sentences ("No subscribers yet").
   */
  subscriberName: string;
  addButton: string;
  addDialogTitle: string;
} = {
  addChoiceTitle: translationKey("When you add them"),
  subscribeNowTitle: translationKey("Subscribe them now"),
  subscribeNowDescription: translationKey(
    "They get updates from now on. Nothing is sent to them now.",
  ),
  subscribeAndTellTitle: translationKey("Subscribe them now and tell them"),
  subscribeAndTellDescription: translationKey(
    "We email them that they are subscribed, with a link to unsubscribe.",
  ),
  askToConfirmTitle: translationKey("Ask them to confirm first"),
  askToConfirmDescription: translationKey(
    "We email them a link. They get updates once they click it.",
  ),
  statusTitle: translationKey("Status"),
  subscribedTitle: translationKey("Subscribed"),
  subscribedDescription: translationKey("Gets this status page's updates."),
  awaitingConfirmationTitle: translationKey("Awaiting Confirmation"),
  awaitingConfirmationDescription: translationKey(
    "Gets nothing until they click the link we emailed them.",
  ),
  awaitingTextConfirmationDescription: translationKey(
    "Gets nothing until they open the link we texted them.",
  ),
  unsubscribedTitle: translationKey("Unsubscribed"),
  unsubscribedDescription: translationKey("Gets nothing."),
  linkExpiredTitle: translationKey("Link Expired"),
  linkExpiredDescription: translationKey(
    "Gets nothing: the link we sent them to confirm expired before they opened it. They can sign up again, or you can add them again.",
  ),
  welcomeTitle: translationKey("Send a welcome message"),
  welcomeDescription: translationKey(
    "Tells them they are subscribed, with a link to unsubscribe.",
  ),
  internalNoteDescription: translationKey("Only your team sees it."),
  subscriberName: translationKey("Subscriber"),
  addButton: translationKey("Add Subscriber"),
  addDialogTitle: translationKey("Add New Subscriber"),
};

// The form-only values the choices keep their picks in: never sent.
export const SUBSCRIBER_ADD_CHOICE_FIELD_KEY: string = "subscriberAddChoice";
export const SUBSCRIBER_STATUS_FIELD_KEY: string = "subscriberStatus";

/*
 * The columns an answer to "When you add them" writes. Subscribe them now
 * is what the two switches started as (confirmed, nothing sent); Ask them
 * to confirm first is the first switch turned off, the second left off.
 */
export const SUBSCRIBER_ADD_CHOICE_COLUMNS: Record<
  SubscriberAddChoice,
  { isSubscriptionConfirmed: boolean; sendYouHaveSubscribedMessage: boolean }
> = {
  [SubscriberAddChoice.SubscribeNow]: {
    isSubscriptionConfirmed: true,
    sendYouHaveSubscribedMessage: false,
  },
  [SubscriberAddChoice.SubscribeAndTell]: {
    isSubscriptionConfirmed: true,
    sendYouHaveSubscribedMessage: true,
  },
  [SubscriberAddChoice.AskToConfirm]: {
    isSubscriptionConfirmed: false,
    sendYouHaveSubscribedMessage: false,
  },
};

/*
 * The answer two stored columns make, as the server acts on them when the
 * subscriber is created: not confirmed is a confirmation link whatever the
 * second says; confirmed sends the welcome only with the second on.
 */
export const readSubscriberAddChoice: (
  values: Values,
) => SubscriberAddChoice = (values: Values): SubscriberAddChoice => {
  if (values["isSubscriptionConfirmed"] === false) {
    return SubscriberAddChoice.AskToConfirm;
  }

  if (values["sendYouHaveSubscribedMessage"] === true) {
    return SubscriberAddChoice.SubscribeAndTell;
  }

  return SubscriberAddChoice.SubscribeNow;
};

export const SUBSCRIBER_ADD_CHOICE: ColumnChoiceConfig<SubscriberAddChoice> = {
  key: SUBSCRIBER_ADD_CHOICE_FIELD_KEY,
  title: SubscriberFormCopy.addChoiceTitle,
  options: [
    {
      value: SubscriberAddChoice.SubscribeNow,
      title: SubscriberFormCopy.subscribeNowTitle,
      description: SubscriberFormCopy.subscribeNowDescription,
    },
    {
      value: SubscriberAddChoice.SubscribeAndTell,
      title: SubscriberFormCopy.subscribeAndTellTitle,
      description: SubscriberFormCopy.subscribeAndTellDescription,
    },
    {
      value: SubscriberAddChoice.AskToConfirm,
      title: SubscriberFormCopy.askToConfirmTitle,
      description: SubscriberFormCopy.askToConfirmDescription,
    },
  ],
  readChoice: readSubscriberAddChoice,
  getColumns: (choice: SubscriberAddChoice): Values => {
    return { ...SUBSCRIBER_ADD_CHOICE_COLUMNS[choice] };
  },
  dataTestId: "subscriber-add-choice",
};

// The status a stored subscriber has, as the tables' Status column reads it.
export const readSubscriberStatus: (
  values: Values,
) => SubscriberStatusChoice = (values: Values): SubscriberStatusChoice => {
  if (values["isUnsubscribed"] === true) {
    return SubscriberStatusChoice.Unsubscribed;
  }

  if (values["isSubscriptionConfirmed"] === false) {
    return SubscriberStatusChoice.AwaitingConfirmation;
  }

  return SubscriberStatusChoice.Subscribed;
};

/*
 * Whether an email subscriber's Edit form offers an answer. Awaiting
 * Confirmation only to a subscriber who is awaiting it: nothing sends a
 * new link to anyone put back to it (the confirmation link goes out when a
 * subscriber is added), so a subscribed or unsubscribed one would wait for
 * a link that never comes and get nothing.
 */
export const isEmailSubscriberStatusOffered: (
  choice: SubscriberStatusChoice,
  openedWith: SubscriberStatusChoice,
) => boolean = (
  choice: SubscriberStatusChoice,
  openedWith: SubscriberStatusChoice,
): boolean => {
  return (
    choice !== SubscriberStatusChoice.AwaitingConfirmation ||
    openedWith === SubscriberStatusChoice.AwaitingConfirmation
  );
};

/*
 * The Status of a subscriber who may be awaiting confirmation: the three
 * the table shows, Awaiting Confirmation only while they are awaiting it
 * (see isEmailSubscriberStatusOffered), described as the link reaches them.
 * Subscribed confirms one who has not opened the link yet (as turning "Do
 * not send confirmation link" on did): the team vouches for them, as for a
 * subscriber it adds. Unsubscribed leaves whether they had confirmed as it
 * is.
 */
const getConfirmingSubscriberStatus: (
  awaitingConfirmationDescription: string,
) => ColumnChoiceConfig<SubscriberStatusChoice> = (
  awaitingConfirmationDescription: string,
): ColumnChoiceConfig<SubscriberStatusChoice> => {
  return {
    key: SUBSCRIBER_STATUS_FIELD_KEY,
    title: SubscriberFormCopy.statusTitle,
    options: [
      {
        value: SubscriberStatusChoice.Subscribed,
        title: SubscriberFormCopy.subscribedTitle,
        description: SubscriberFormCopy.subscribedDescription,
      },
      {
        value: SubscriberStatusChoice.AwaitingConfirmation,
        title: SubscriberFormCopy.awaitingConfirmationTitle,
        description: awaitingConfirmationDescription,
      },
      {
        value: SubscriberStatusChoice.Unsubscribed,
        title: SubscriberFormCopy.unsubscribedTitle,
        description: SubscriberFormCopy.unsubscribedDescription,
      },
    ],
    readChoice: readSubscriberStatus,
    getColumns: (choice: SubscriberStatusChoice): Values => {
      if (choice === SubscriberStatusChoice.Unsubscribed) {
        return { isUnsubscribed: true };
      }

      return {
        isUnsubscribed: false,
        isSubscriptionConfirmed: choice === SubscriberStatusChoice.Subscribed,
      };
    },
    isOptionOffered: isEmailSubscriberStatusOffered,
    dataTestId: "subscriber-status",
  };
};

// An email subscriber's Status: awaiting the link we emailed them.
export const EMAIL_SUBSCRIBER_STATUS: ColumnChoiceConfig<SubscriberStatusChoice> =
  getConfirmingSubscriberStatus(
    SubscriberFormCopy.awaitingConfirmationDescription,
  );

/*
 * An SMS subscriber's Status: one who signed up by SMS on the status page
 * awaits the link we texted them.
 */
export const SMS_SUBSCRIBER_STATUS: ColumnChoiceConfig<SubscriberStatusChoice> =
  getConfirmingSubscriberStatus(
    SubscriberFormCopy.awaitingTextConfirmationDescription,
  );

/*
 * A Slack, Microsoft Teams or webhook subscriber's Status: subscribed or
 * not. Nobody of these channels waits for a confirmation.
 */
export const SUBSCRIBER_STATUS: ColumnChoiceConfig<SubscriberStatusChoice> = {
  key: SUBSCRIBER_STATUS_FIELD_KEY,
  title: SubscriberFormCopy.statusTitle,
  options: [
    {
      value: SubscriberStatusChoice.Subscribed,
      title: SubscriberFormCopy.subscribedTitle,
      description: SubscriberFormCopy.subscribedDescription,
    },
    {
      value: SubscriberStatusChoice.Unsubscribed,
      title: SubscriberFormCopy.unsubscribedTitle,
      description: SubscriberFormCopy.unsubscribedDescription,
    },
  ],
  readChoice: (values: Values): SubscriberStatusChoice => {
    return values["isUnsubscribed"] === true
      ? SubscriberStatusChoice.Unsubscribed
      : SubscriberStatusChoice.Subscribed;
  },
  getColumns: (choice: SubscriberStatusChoice): Values => {
    return { isUnsubscribed: choice === SubscriberStatusChoice.Unsubscribed };
  },
  dataTestId: "subscriber-status",
};

/*
 * What an email or SMS subscriber table's Status column shows for a
 * subscriber at `now` (the browser's clock): Unsubscribed, Subscribed, and
 * - for one not confirmed yet - Awaiting Confirmation while the link we
 * sent them works, a day from Created At (SubscriptionConfirmationLink),
 * or Link Expired once it has run out: they never will confirm with it,
 * and are sent nothing. The table reads Created At for its Subscribed At
 * column; a subscriber whose age cannot be told is taken as expired, as the
 * server takes it.
 */
export enum SubscriberTableStatus {
  Subscribed = "subscribed",
  AwaitingConfirmation = "awaiting-confirmation",
  LinkExpired = "link-expired",
  Unsubscribed = "unsubscribed",
}

export const getSubscriberTableStatus: (
  values: Values,
  now?: number,
) => SubscriberTableStatus = (
  values: Values,
  now: number = Date.now(),
): SubscriberTableStatus => {
  const status: SubscriberStatusChoice = readSubscriberStatus(values);

  if (status === SubscriberStatusChoice.Unsubscribed) {
    return SubscriberTableStatus.Unsubscribed;
  }

  if (status === SubscriberStatusChoice.Subscribed) {
    return SubscriberTableStatus.Subscribed;
  }

  return SubscriptionConfirmationLink.hasExpired(
    values["createdAt"] as Date | string | undefined,
    now,
  )
    ? SubscriberTableStatus.LinkExpired
    : SubscriberTableStatus.AwaitingConfirmation;
};

// The columns Add in Bulk sends for an answer (it has no hidden columns).
export const getSubscriberAddChoiceColumns: (choice: unknown) => {
  isSubscriptionConfirmed: boolean;
  sendYouHaveSubscribedMessage: boolean;
} = (
  choice: unknown,
): {
  isSubscriptionConfirmed: boolean;
  sendYouHaveSubscribedMessage: boolean;
} => {
  const known: SubscriberAddChoice = Object.values(
    SubscriberAddChoice,
  ).includes(choice as SubscriberAddChoice)
    ? (choice as SubscriberAddChoice)
    : SubscriberAddChoice.SubscribeNow;

  return { ...SUBSCRIBER_ADD_CHOICE_COLUMNS[known] };
};

export default SubscriberFormCopy;
