/*
 * What a subscriber notification says when its send was interrupted: its
 * worker crashed, was redeployed or lost its database connection part-way,
 * so nothing was left to settle it, and the sweeper
 * (StatusPageSubscriber:TimeoutStuckNotifications) marked it Failed rather
 * than leave it "being sent" forever.
 *
 * Shared by the sweeper, which writes it, and anything that wants to tell an
 * interruption from an ordinary failure.
 */
export default class SubscriberNotificationInterruption {
  public static readonly messagePrefix: string = "Interrupted:";

  /*
   * For the incident created notification, which records the status pages
   * it has told as it goes (Incident.statusPagesNotifiedOnCreation), so
   * Retry picks up after them.
   */
  public static readonly resumesMessage: string = `${SubscriberNotificationInterruption.messagePrefix} this notification stopped being sent before it finished, because the server sending it restarted or stopped responding. The status pages it finished are recorded, so Retry sends it only to the status pages that were not sent it in full.`;

  // For every other notification, which Retry sends to every status page.
  public static readonly resendsMessage: string = `${SubscriberNotificationInterruption.messagePrefix} this notification stopped being sent before it finished, because the server sending it restarted or stopped responding, so some subscribers may not have been sent it. Retry sends it again to every status page, including the subscribers who already got it.`;

  public static isInterruptedMessage(
    message: string | null | undefined,
  ): boolean {
    return Boolean(
      message &&
        message.startsWith(SubscriberNotificationInterruption.messagePrefix),
    );
  }
}
