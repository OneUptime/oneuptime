import StatusPageSubscriberNotificationEventType from "./StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "./StatusPageSubscriberNotificationMethod";

/*
 * Which channels actually send each subscriber notification, and so which
 * event type / channel pairs a custom template can be written for. The
 * dashboard offers only these pairs and the template service refuses the rest,
 * so nobody can save a template that no sender would ever use.
 *
 * - A subscription confirmation is a double opt-in link, and only email
 *   subscribers confirm.
 * - Webhook subscribers have no way to ask for a management link: the public
 *   status page identifies a subscriber by email, phone or workspace name.
 * - The recurring report is an email report (Status Page > Reports).
 */

const ALL_METHODS: Array<StatusPageSubscriberNotificationMethod> = [
  StatusPageSubscriberNotificationMethod.Email,
  StatusPageSubscriberNotificationMethod.SMS,
  StatusPageSubscriberNotificationMethod.Slack,
  StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  StatusPageSubscriberNotificationMethod.Webhook,
];

const RESTRICTED_METHODS: Partial<
  Record<
    StatusPageSubscriberNotificationEventType,
    Array<StatusPageSubscriberNotificationMethod>
  >
> = {
  [StatusPageSubscriberNotificationEventType.SubscriberSubscriptionConfirmation]:
    [StatusPageSubscriberNotificationMethod.Email],
  [StatusPageSubscriberNotificationEventType.SubscriberManageSubscription]: [
    StatusPageSubscriberNotificationMethod.Email,
    StatusPageSubscriberNotificationMethod.SMS,
    StatusPageSubscriberNotificationMethod.Slack,
    StatusPageSubscriberNotificationMethod.MicrosoftTeams,
  ],
  [StatusPageSubscriberNotificationEventType.SubscriberReport]: [
    StatusPageSubscriberNotificationMethod.Email,
  ],
};

export default class SubscriberNotificationTemplateChannels {
  public static getSupportedNotificationMethods(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<StatusPageSubscriberNotificationMethod> {
    return [...(RESTRICTED_METHODS[eventType] || ALL_METHODS)];
  }

  public static isSupported(
    eventType: StatusPageSubscriberNotificationEventType,
    notificationMethod: StatusPageSubscriberNotificationMethod,
  ): boolean {
    return this.getSupportedNotificationMethods(eventType).includes(
      notificationMethod,
    );
  }

  public static getSupportedEventTypes(
    notificationMethod: StatusPageSubscriberNotificationMethod,
  ): Array<StatusPageSubscriberNotificationEventType> {
    return Object.values(StatusPageSubscriberNotificationEventType).filter(
      (eventType: StatusPageSubscriberNotificationEventType): boolean => {
        return this.isSupported(eventType, notificationMethod);
      },
    );
  }
}
